import { Router } from 'express';
import { q, telNorm } from '../db.mjs';
import { requiere, alcanceSQL } from '../auth.mjs';
import {
  notificar, auditar, historial, etapaActiva, nombreEtapa,
  asignarEquitativo, responsableUltimoCierre, negActivaDeContacto, negActivaPorTel, crearContacto, buscarContacto
} from '../core.mjs';
import { emitir } from '../realtime.mjs';
import { obtener as obtenerArchivo } from '../archivos.mjs';
import * as ubi from '../ubicaciones.mjs';

const r = Router();

const SELECT_BASE = `
  SELECT n.*, c.nombre AS cliente, c.tel, c.frecuente, c.email AS cliente_email,
         c.direccion AS cliente_direccion, c.lat AS cliente_lat, c.lon AS cliente_lon,
         u.nombre AS agente_nombre, ca.tipo AS canal_tipo, ca.nombre AS canal_nombre,
         (SELECT COUNT(*) FROM transferencias t WHERE t.negociacion_id=n.id) AS n_transferencias,
         (SELECT COUNT(*) FROM ubicaciones ub WHERE ub.negociacion_id=n.id) AS n_ubicaciones
    FROM negociaciones n
    JOIN contactos c ON c.id = n.contacto_id
    LEFT JOIN usuarios u ON u.id = n.agente_id
    LEFT JOIN canales ca ON ca.id = n.canal_id`;

async function obtenerNegociacionVisible(req, id) {
  const { where, params } = await alcanceSQL(req.user, req.empresaId, 'n', 3);
  const { rows } = await q(
    `${SELECT_BASE} WHERE n.id=$1 AND n.empresa_id=$2 ${where}`,
    [id, req.empresaId, ...params]);
  return rows[0] || null;
}

r.get('/', requiere(), async (req, res) => {
  const { where, params } = await alcanceSQL(req.user, req.empresaId, 'n', 2);
  const { rows } = await q(`${SELECT_BASE} WHERE n.empresa_id = $1 ${where} ORDER BY n.actualizado DESC`,
    [req.empresaId, ...params]);
  res.json(rows);
});

r.get('/util/duplicados', requiere('admin'), async (req, res) => {
  const activas = (req.empresa.etapas || []).filter(e => e.activa).map(e => e.id);
  const { rows } = await q(
    `SELECT n.id, n.etapa, n.creado, c.nombre, u.nombre AS agente
       FROM negociaciones n JOIN contactos c ON c.id=n.contacto_id
       LEFT JOIN usuarios u ON u.id=n.agente_id
      WHERE n.empresa_id=$1 AND n.etapa = ANY($2)
        AND n.id NOT IN (SELECT DISTINCT ON (contacto_id) id FROM negociaciones
                          WHERE empresa_id=$1 AND etapa = ANY($2) ORDER BY contacto_id, creado ASC)
      ORDER BY c.nombre`, [req.empresaId, activas]);
  res.json(rows);
});

r.get('/:id', requiere(), async (req, res) => {
  const n = await obtenerNegociacionVisible(req, req.params.id);
  if (!n) return res.status(404).json({ error: 'no encontrada' });
  const [msgs, hist, trans, ubis] = await Promise.all([
    q(`SELECT m.*, a.archivo, a.mime, a.tipo AS archivo_tipo, a.nombre AS archivo_nombre,
              a.bytes AS archivo_bytes, a.ancho, a.alto,
              CASE WHEN a.id IS NOT NULL THEN '/media/' || a.empresa_id || '/' || a.archivo ELSE m.media_url END AS media_url
         FROM mensajes m LEFT JOIN archivos a ON a.id = m.archivo_id
        WHERE m.negociacion_id=$1 ORDER BY m.ts ASC`, [n.id]),
    q('SELECT * FROM historial WHERE negociacion_id=$1 ORDER BY ts DESC', [n.id]),
    q('SELECT * FROM transferencias WHERE negociacion_id=$1 ORDER BY ts DESC', [n.id]),
    q('SELECT * FROM ubicaciones WHERE negociacion_id=$1 ORDER BY ts DESC', [n.id])
  ]);
  res.json({ ...n, mensajes: msgs.rows, historial: hist.rows, transferencias: trans.rows, ubicaciones: ubis.rows });
});

/* ---------- MOVER DE ETAPA ---------- */
r.patch('/:id/etapa', requiere(), async (req, res) => {
  const emp = req.empresa;
  const { etapa, monto, motivo } = req.body || {};
  const n = await obtenerNegociacionVisible(req, req.params.id);
  if (!n) return res.status(404).json({ error: 'no encontrada' });
  if (n.etapa === etapa) return res.json({ ok: true, sinCambios: true });

  if (etapa === 'ganado' && emp.flags?.montoObligatorio && !(Number(monto) > 0))
    return res.status(422).json({ error: 'monto_requerido', mensaje: 'El monto de cierre es obligatorio.' });
  if (etapa === 'cerrado' && !motivo)
    return res.status(422).json({ error: 'motivo_requerido', mensaje: 'Indicá el motivo de cierre.' });
  if (emp.flags?.antiDuplicado && etapaActiva(emp, etapa) && !etapaActiva(emp, n.etapa)) {
    const dup = await negActivaDeContacto(emp, n.contacto_id, n.id);
    if (dup) return res.status(409).json({ error: 'duplicado', negociacionId: dup.id,
      mensaje: `${n.cliente} ya tiene una negociación abierta en ${nombreEtapa(emp, dup.etapa)}.` });
  }

  const marcadores = new Set(n.marcadores || []);
  if (etapaActiva(emp, etapa) && !etapaActiva(emp, n.etapa) && emp.flags?.marcadorFrecuente) {
    marcadores.add('frecuente');
    await q('UPDATE contactos SET frecuente=TRUE WHERE id=$1 AND empresa_id=$2', [n.contacto_id, req.empresaId]);
  }
  let agente = n.agente_id;
  if (etapa !== 'nuevo' && !agente) agente = req.user.rol === 'agente' ? req.user.id : await asignarEquitativo(emp, { sucursal: n.sucursal, linea: n.linea });

  const montoCierre = etapa === 'ganado' ? Number(monto || n.monto_cierre || 0) : 0;
  await q(
    `UPDATE negociaciones SET etapa=$2, agente_id=$3, marcadores=$4, motivo=$5,
       monto_cierre=$6, valor = CASE WHEN $2='ganado' THEN $6 ELSE valor END,
       actualizado=now(), entrada_etapa=now(), aviso_sla=FALSE WHERE id=$1 AND empresa_id=$7`,
    [n.id, etapa, agente, JSON.stringify([...marcadores]), etapa === 'cerrado' ? motivo : null,
     montoCierre, req.empresaId]);

  await historial(req.empresaId, n.id,
    `${nombreEtapa(emp, n.etapa)} → ${nombreEtapa(emp, etapa)}` +
    (etapa === 'ganado' ? ` · Monto Gs ${montoCierre.toLocaleString('es-PY')}` : '') +
    (etapa === 'cerrado' ? ` · ${motivo}` : ''), req.user.nombre);

  if (etapa === 'ganado') await notificar(emp, 'ganado',
    { agente: req.user.nombre, cliente: n.cliente, monto: `Gs ${montoCierre.toLocaleString('es-PY')}` }, [], n.id);
  await auditar(req.empresaId, req.user.nombre, 'Etapa', `${n.etapa}→${etapa}`, req.ip);
  emitir(req.empresaId, 'neg:patch', { id: n.id });
  res.json({ ok: true });
});

r.patch('/:id', requiere(), async (req, res) => {
  const { titulo, valor, origen } = req.body || {};
  const n = await obtenerNegociacionVisible(req, req.params.id);
  if (!n) return res.status(404).json({ error: 'no encontrada' });
  const v = Number(valor || 0);
  if (n.etapa === 'ganado' && req.empresa.flags?.montoObligatorio && v <= 0)
    return res.status(422).json({ error: 'monto_requerido', mensaje: 'El monto de cierre debe ser mayor a cero.' });
  await q(
    `UPDATE negociaciones SET titulo=$2, origen=COALESCE($3,origen), valor=$4,
       monto_cierre = CASE WHEN etapa='ganado' THEN $4 ELSE monto_cierre END,
       actualizado=now() WHERE id=$1 AND empresa_id=$5`, [n.id, titulo ?? n.titulo, origen, v, req.empresaId]);
  await historial(req.empresaId, n.id, 'Datos actualizados', req.user.nombre);
  emitir(req.empresaId, 'neg:patch', { id: n.id });
  res.json({ ok: true });
});

r.post('/:id/transferir', requiere(), async (req, res) => {
  const { destinoId, nota } = req.body || {};
  const emp = req.empresa;
  const n = await obtenerNegociacionVisible(req, req.params.id);
  if (!n) return res.status(404).json({ error: 'no encontrada' });
  const { rows: us } = await q('SELECT * FROM usuarios WHERE id=$1 AND empresa_id=$2 AND activo', [destinoId, req.empresaId]);
  const dest = us[0];
  if (!dest) return res.status(404).json({ error: 'usuario destino inválido' });

  const { rows: ant } = await q('SELECT nombre FROM usuarios WHERE id=$1', [n.agente_id]);
  const marcadores = new Set(n.marcadores || []);
  if (emp.flags?.marcadorTransferido) marcadores.add('transferido');
  await q(`INSERT INTO transferencias (empresa_id,negociacion_id,de_nombre,a_nombre,por,nota)
           VALUES ($1,$2,$3,$4,$5,$6)`,
    [req.empresaId, n.id, ant[0]?.nombre || null, dest.nombre, req.user.nombre, nota || '']);
  await q(`UPDATE negociaciones SET agente_id=$3, sucursal=$4, linea=$5, marcadores=$6, actualizado=now()
            WHERE id=$1 AND empresa_id=$2`,
    [n.id, req.empresaId, dest.id, dest.sucursal, dest.linea, JSON.stringify([...marcadores])]);
  await q('UPDATE contactos SET responsable_id=$3 WHERE id=$1 AND empresa_id=$2',
    [n.contacto_id, req.empresaId, dest.id]);
  await historial(req.empresaId, n.id,
    `⇄ Transferida de ${ant[0]?.nombre || 'sin asignar'} a ${dest.nombre}${nota ? ' · ' + nota : ''}`, req.user.nombre);
  await notificar(emp, 'transfer', { origenUsr: req.user.nombre, cliente: n.cliente }, [dest.id], n.id);
  await auditar(req.empresaId, req.user.nombre, 'Transferencia', `→ ${dest.nombre}`, req.ip);
  emitir(req.empresaId, 'neg:patch', { id: n.id });
  res.json({ ok: true });
});

r.patch('/:id/bot', requiere(), async (req, res) => {
  const n = await obtenerNegociacionVisible(req, req.params.id);
  if (!n) return res.status(404).json({ error: 'no encontrada' });
  const activo = !!req.body?.activo;
  await q('UPDATE negociaciones SET bot_activo=$2 WHERE id=$1 AND empresa_id=$3', [n.id, activo, req.empresaId]);
  await historial(req.empresaId, req.params.id, `Bot ${activo ? 'reactivado' : 'desactivado'} manualmente`, req.user.nombre);
  emitir(req.empresaId, 'neg:patch', { id: req.params.id });
  res.json({ ok: true });
});

/* ---------- MENSAJES ---------- */
r.post('/:id/mensajes', requiere(), async (req, res) => {
  const emp = req.empresa;
  const texto = String(req.body?.texto || '').trim();
  const archivoId = req.body?.archivoId || null;
  if (!texto && !archivoId) return res.status(422).json({ error: 'Escribí un mensaje o adjuntá un archivo.' });

  let adjunto = null;
  if (archivoId) {
    adjunto = await obtenerArchivo(archivoId, req.empresaId);
    if (!adjunto) return res.status(404).json({ error: 'El archivo adjunto no existe.' });
  }
  const n = await obtenerNegociacionVisible(req, req.params.id);
  if (!n) return res.status(404).json({ error: 'no encontrada' });

  if (emp.flags?.botAutoOff && n.bot_activo) {
    await q('UPDATE negociaciones SET bot_activo=FALSE WHERE id=$1 AND empresa_id=$2', [n.id, req.empresaId]);
    await historial(req.empresaId, n.id, '🤖 Bot desactivado automáticamente: respondió un agente', 'Sistema');
  }
  if (n.etapa === 'nuevo' || n.etapa === 'espera') {
    await q(`UPDATE negociaciones SET etapa='contactado', entrada_etapa=now(), aviso_sla=FALSE,
               agente_id=COALESCE(agente_id,$2) WHERE id=$1 AND empresa_id=$3`, [n.id, req.user.id, req.empresaId]);
    await historial(req.empresaId, n.id, `${nombreEtapa(emp, n.etapa)} → Contactado (respuesta del agente)`, req.user.nombre);
  }
  await encolarSalida(req, n, texto, adjunto);
  emitir(req.empresaId, 'neg:patch', { id: n.id });
  res.json({ ok: true });
});

r.post('/:id/regestionar', requiere(), async (req, res) => {
  const emp = req.empresa;
  const texto = String(req.body?.texto || '').trim();
  const archivoId = req.body?.archivoId || null;
  if (!texto && !archivoId) return res.status(422).json({ error: 'Escribí un mensaje o adjuntá un archivo.' });
  const adjunto = archivoId ? await obtenerArchivo(archivoId, req.empresaId) : null;

  const o = await obtenerNegociacionVisible(req, req.params.id);
  if (!o) return res.status(404).json({ error: 'no encontrada' });
  if (emp.flags?.antiDuplicado) {
    const dup = await negActivaDeContacto(emp, o.contacto_id);
    if (dup) return res.status(409).json({ error: 'duplicado', negociacionId: dup.id });
  }
  const marcadores = [];
  if (emp.flags?.marcadorRegestion) marcadores.push('regestionado');
  if (emp.flags?.marcadorFrecuente) marcadores.push('frecuente');

  const { rows: ns } = await q(
    `INSERT INTO negociaciones (empresa_id,contacto_id,titulo,etapa,origen,canal_id,agente_id,sucursal,linea,marcadores,bot_activo)
     VALUES ($1,$2,$3,'contactado',$4,$5,$6,$7,$8,$9,FALSE) RETURNING *`,
    [req.empresaId, o.contacto_id, `Re gestión · ${o.titulo || ''}`, o.origen, o.canal_id,
     req.user.rol === 'agente'
       ? req.user.id
       : ((await responsableUltimoCierre(emp, o.contacto_id))
          || await asignarEquitativo(emp, { sucursal: o.sucursal, linea: o.linea })),
     o.sucursal, o.linea, JSON.stringify(marcadores)]);
  const n = ns[0];
  await q('UPDATE contactos SET frecuente=TRUE WHERE id=$1 AND empresa_id=$2', [o.contacto_id, req.empresaId]);
  await historial(req.empresaId, n.id, `Nueva negociación por re contacto desde ${nombreEtapa(emp, o.etapa)} · bot desactivado`, req.user.nombre);
  await historial(req.empresaId, o.id, 'Cliente re contactado · se generó nueva negociación', req.user.nombre);
  await encolarSalida(req, n, texto, adjunto);
  emitir(req.empresaId, 'neg:nueva', { id: n.id });
  res.json({ ok: true, id: n.id });
});

async function encolarSalida(req, n, texto, adjunto) {
  const { rows: cs } = await q('SELECT * FROM contactos WHERE id=$1 AND empresa_id=$2',
    [n.contacto_id, req.empresaId]);
  const c = cs[0];
  const { rows: canales } = await q(
    `SELECT * FROM canales WHERE empresa_id=$1 AND activo AND ($2::uuid IS NULL OR id=$2)
      ORDER BY (id=$2) DESC LIMIT 1`, [req.empresaId, n.canal_id]);
  const canal = canales[0] || null;
  const destino = canal
    ? (canal.tipo.startsWith('whatsapp') ? (c.externos?.whatsapp || c.tel)
      : (c.externos?.[canal.tipo === 'messenger' ? 'messenger' : 'instagram'] || ''))
    : '';
  const estado = canal && destino ? 'pendiente' : 'ok';

  await q(
    `INSERT INTO mensajes (empresa_id,negociacion_id,dir,txt,autor_id,estado,archivo_id,media_url,media_tipo,media_nombre,media_bytes)
     VALUES ($1,$2,'out',$3,$4,$5,$6,$7,$8,$9,$10)`,
    [req.empresaId, n.id, texto, req.user.id, estado, adjunto?.id || null, adjunto?.url || null,
     adjunto?.tipo || null, adjunto?.nombre || null, adjunto?.bytes || null]);
  await q('UPDATE negociaciones SET actualizado=now() WHERE id=$1 AND empresa_id=$2', [n.id, req.empresaId]);
  await historial(req.empresaId, n.id, adjunto ? `Adjunto enviado: ${adjunto.nombre}` : 'Mensaje enviado', req.user.nombre);

  if (canal && destino) {
    await q(
      `INSERT INTO outbox (empresa_id,canal_id,negociacion_id,destino,txt,archivo_id,media_url,media_tipo,media_nombre)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [req.empresaId, canal.id, n.id, destino, texto, adjunto?.id || null,
       adjunto?.url || null, adjunto?.tipo || null, adjunto?.nombre || null]);

    // Intentar el envío inmediatamente. El worker periódico conserva la garantía de reintento.
    import('../worker.mjs')
      .then(({ drenarOutbox }) => drenarOutbox())
      .catch(e => console.error('[outbox inmediato]', e.message));
  }
}

/* ---------- UBICACIONES ---------- */
r.get('/:id/ubicaciones', requiere(), async (req, res) => {
  const n = await obtenerNegociacionVisible(req, req.params.id);
  if (!n) return res.status(404).json({ error: 'no encontrada' });
  const { rows } = await q(
    'SELECT * FROM ubicaciones WHERE negociacion_id=$1 AND empresa_id=$2 ORDER BY ts DESC',
    [n.id, req.empresaId]);
  res.json(rows.map(u => ({ ...u, mapa: ubi.linkMapa(u.lat, u.lon, u.direccion || u.texto) })));
});

r.post('/:id/ubicaciones/confirmar', requiere(), async (req, res) => {
  const n = await obtenerNegociacionVisible(req, req.params.id);
  if (!n) return res.status(404).json({ error: 'no encontrada' });
  const { ubicacionId } = req.body || {};
  const { rows } = await q(
    'SELECT * FROM ubicaciones WHERE id=$1 AND empresa_id=$2 AND negociacion_id=$3',
    [ubicacionId, req.empresaId, n.id]);
  const u = rows[0];
  if (!u) return res.status(404).json({ error: 'no encontrada' });
  await q('UPDATE ubicaciones SET confirmada=TRUE WHERE id=$1 AND empresa_id=$2', [u.id, req.empresaId]);
  await q(`UPDATE contactos SET direccion=COALESCE(NULLIF($3,''),direccion), lat=COALESCE($4,lat), lon=COALESCE($5,lon)
            WHERE id=$1 AND empresa_id=$2`,
    [u.contacto_id, req.empresaId, u.direccion || u.texto, u.lat, u.lon]);
  await historial(req.empresaId, req.params.id, `📍 Dirección confirmada: ${u.direccion || u.texto}`, req.user.nombre);
  res.json({ ok: true });
});

/** Analiza un texto a pedido (botón "detectar dirección" del agente). */
r.post('/:id/detectar-ubicacion', requiere(), async (req, res) => {
  const texto = String(req.body?.texto || '');
  const det = ubi.detectar(texto);
  if (!det) return res.json({ encontrada: false });
  const n = await obtenerNegociacionVisible(req, req.params.id);
  if (!n) return res.status(404).json({ error: 'no encontrada' });
  const u = await ubi.registrar(req.empresa, { contactoId: n.contacto_id, negociacionId: n.id, det });
  res.json({ encontrada: true, ubicacion: { ...u, mapa: ubi.linkMapa(u.lat, u.lon, u.direccion || u.texto) } });
});

/* ---------- CARGA MANUAL ---------- */
r.post('/manual', requiere('admin'), async (req, res) => {
  const emp = req.empresa;
  if (!emp.flags?.cargaManual) return res.status(403).json({ error: 'función desactivada' });
  const b = req.body || {};
  if (!b.nombre || !b.tel || !b.mensaje)
    return res.status(422).json({ error: 'Nombre, teléfono y mensaje del cliente son obligatorios.' });
  const etapa = b.etapa || 'contactado';
  if (emp.flags?.antiDuplicado && etapaActiva(emp, etapa)) {
    const dup = await negActivaPorTel(emp, b.tel);
    if (dup) return res.status(409).json({ error: 'duplicado', negociacionId: dup.id,
      mensaje: `Ese cliente ya tiene una negociación abierta en ${nombreEtapa(emp, dup.etapa)}.` });
  }
  let c = await buscarContacto(emp, { tel: b.tel });
  const reingreso = !!c;
  const agente = b.agenteId
    || (c ? await responsableUltimoCierre(emp, c.id) : null)
    || await asignarEquitativo(emp, { sucursal: b.sucursal, linea: b.linea });
  const cuando = b.fecha ? new Date(b.fecha) : new Date();
  if (!c) {
    c = await crearContacto(emp, { nombre: b.nombre, tel: b.tel, email: b.email, doc: b.doc,
      ciudad: b.ciudad, sucursal: b.sucursal, linea: b.linea, responsable_id: agente,
      externos: { whatsapp: String(b.tel).replace(/\D/g, '') } });
  }
  const marcadores = ['manual'];
  if (reingreso && emp.flags?.marcadorFrecuente) {
    marcadores.push('frecuente');
    await q('UPDATE contactos SET frecuente=TRUE WHERE id=$1 AND empresa_id=$2', [c.id, req.empresaId]);
  }
  const { rows } = await q(
    `INSERT INTO negociaciones (empresa_id,contacto_id,titulo,etapa,origen,canal_id,agente_id,sucursal,linea,valor,marcadores,bot_activo,creado,entrada_etapa)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13) RETURNING *`,
    [req.empresaId, c.id, `Carga manual · ${b.motivoCarga || 'Otro'}`, etapa, b.origen || 'otro',
     b.canalId || null, agente, b.sucursal || c.sucursal, b.linea || c.linea, Number(b.valor || 0),
     JSON.stringify(marcadores), !b.respuesta, cuando]);
  const n = rows[0];

  const adj = b.archivoId ? await obtenerArchivo(b.archivoId, req.empresaId) : null;
  await q(`INSERT INTO mensajes (empresa_id,negociacion_id,dir,txt,ts,archivo_id,media_url,media_tipo,media_nombre)
           VALUES ($1,$2,'in',$3,$4,$5,$6,$7,$8)`,
    [req.empresaId, n.id, b.mensaje, cuando, adj?.id || null, adj?.url || null, adj?.tipo || null, adj?.nombre || null]);
  if (b.respuesta) {
    await q(`INSERT INTO mensajes (empresa_id,negociacion_id,dir,txt,autor_id,ts) VALUES ($1,$2,'out',$3,$4,$5)`,
      [req.empresaId, n.id, b.respuesta, req.user.id, new Date(cuando.getTime() + 60000)]);
  }
  if (emp.flags?.detectarUbicacion) {
    const det = ubi.detectar(b.mensaje);
    if (det) await ubi.registrar(emp, { contactoId: c.id, negociacionId: n.id, det });
  }
  await historial(req.empresaId, n.id,
    `Cargada manualmente por el administrador · Motivo: ${b.motivoCarga || 'Otro'} · Contacto real: ${cuando.toLocaleString('es-PY')}`,
    req.user.nombre);
  await notificar(emp, 'manual', { cliente: c.nombre }, [agente], n.id);
  await auditar(req.empresaId, req.user.nombre, 'Carga manual', `${b.nombre} · ${b.motivoCarga || ''}`, req.ip);
  emitir(req.empresaId, 'neg:nueva', { id: n.id });
  res.json({ ok: true, id: n.id });
});

/* ---------- ELIMINACIÓN ---------- */
r.post('/eliminar', requiere('admin'), async (req, res) => {
  if (!req.empresa.flags?.eliminarNegociaciones) return res.status(403).json({ error: 'función desactivada' });
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
  const motivo = req.body?.motivo || 'sin motivo';
  if (!ids.length) return res.status(422).json({ error: 'sin ids' });
  const { rows } = await q(
    `SELECT n.id, c.nombre, n.etapa FROM negociaciones n JOIN contactos c ON c.id=n.contacto_id
      WHERE n.id = ANY($1::uuid[]) AND n.empresa_id=$2`, [ids, req.empresaId]);
  for (const x of rows) {
    await auditar(req.empresaId, req.user.nombre, 'Eliminación de negociación',
      `${x.nombre} · ${nombreEtapa(req.empresa, x.etapa)} · ${motivo}`, req.ip);
  }
  const { rowCount } = await q('DELETE FROM negociaciones WHERE id = ANY($1::uuid[]) AND empresa_id=$2', [ids, req.empresaId]);
  emitir(req.empresaId, 'neg:borradas', { ids });
  res.json({ ok: true, eliminadas: rowCount });
});

r.post('/eliminar-masivo', requiere('admin'), async (req, res) => {
  if (!req.empresa.flags?.eliminarNegociaciones) return res.status(403).json({ error: 'función desactivada' });
  const { etapa, origen, agenteId, desde, hasta, marcador, soloPrevia } = req.body || {};
  const cond = ['n.empresa_id = $1'], params = [req.empresaId];
  const add = (sql, val) => { params.push(val); cond.push(sql.replace('?', `$${params.length}`)); };
  if (etapa) add('n.etapa = ?', etapa);
  if (origen) add('n.origen = ?', origen);
  if (agenteId) add('n.agente_id = ?', agenteId);
  if (desde) add('n.creado >= ?', desde);
  if (hasta) add('n.creado <= ?', hasta);
  if (marcador) add('n.marcadores @> ?', JSON.stringify([marcador]));
  const { rows } = await q(
    `SELECT n.id, c.nombre, n.etapa, n.creado FROM negociaciones n JOIN contactos c ON c.id=n.contacto_id
      WHERE ${cond.join(' AND ')} ORDER BY n.creado DESC`, params);
  if (soloPrevia) return res.json({ total: rows.length, muestra: rows.slice(0, 50) });
  if (!rows.length) return res.json({ ok: true, eliminadas: 0 });
  await auditar(req.empresaId, req.user.nombre, 'Eliminación masiva', `${rows.length} negociaciones por filtro`, req.ip);
  await q('DELETE FROM negociaciones WHERE id = ANY($1::uuid[]) AND empresa_id=$2', [rows.map(x => x.id), req.empresaId]);
  emitir(req.empresaId, 'neg:borradas', { ids: rows.map(x => x.id) });
  res.json({ ok: true, eliminadas: rows.length });
});

export default r;
