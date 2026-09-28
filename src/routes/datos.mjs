/**
 * Importación y exportación completa de datos.
 * Pensado para migrar desde otro sistema: contactos, negociaciones con su
 * fecha real de creación, responsables, mensajes, historial y ubicaciones.
 */
import { Router } from 'express';
import { q, telNorm } from '../db.mjs';
import { requiere } from '../auth.mjs';
import { auditar, historial, etapaActiva, nombreEtapa, crearContacto, asignarEquitativo } from '../core.mjs';
import { emitir } from '../realtime.mjs';

const r = Router();

/* ============ COLUMNAS DEL FORMATO ============ */
export const COLUMNAS = [
  { k: 'cliente',        t: 'Nombre del cliente',   req: true,  ej: 'Juan Pérez' },
  { k: 'telefono',       t: 'Teléfono',             req: true,  ej: '0981123456' },
  { k: 'email',          t: 'Email',                ej: 'juan@mail.com' },
  { k: 'documento',      t: 'Documento',            ej: '1234567' },
  { k: 'ciudad',         t: 'Ciudad',               ej: 'Asunción' },
  { k: 'direccion',      t: 'Dirección',            ej: 'Av. Mcal. López 1234' },
  { k: 'notas',          t: 'Notas del contacto',   ej: 'Cliente mayorista' },
  { k: 'titulo',         t: 'Título negociación',   ej: 'Consulta por producto X' },
  { k: 'etapa',          t: 'Etapa',                ej: 'contactado' },
  { k: 'origen',         t: 'Origen',               ej: 'whatsapp' },
  { k: 'responsable',    t: 'Responsable (usuario)', ej: 'ana' },
  { k: 'sucursal',       t: 'Sucursal',             ej: 'Central' },
  { k: 'linea',          t: 'Línea',                ej: 'Ventas' },
  { k: 'valor',          t: 'Valor estimado',       ej: '1500000' },
  { k: 'monto_cierre',   t: 'Monto de cierre',      ej: '1450000' },
  { k: 'motivo',         t: 'Motivo de cierre',     ej: 'Sin stock' },
  { k: 'fecha_creacion', t: 'Fecha de creación',    ej: '2024-03-15 10:30' },
  { k: 'fecha_cierre',   t: 'Fecha de cierre',      ej: '2024-03-20 16:00' },
  { k: 'frecuente',      t: 'Cliente frecuente',    ej: 'si' },
  { k: 'marcadores',     t: 'Marcadores',           ej: 'frecuente/manual' },
  { k: 'mensajes',       t: 'Conversación',         ej: 'in|Hola quiero info ;; out|Buenas, te cuento' }
];

const SEP = ';';
const esc = v => {
  const s = String(v ?? '');
  return /[;"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

/** Parser de CSV que respeta comillas y saltos de línea dentro de campos. */
export function parsearCSV(texto, sep = SEP) {
  const t = String(texto).replace(/^\uFEFF/, '');
  const filas = [];
  let fila = [], campo = '', enComillas = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (enComillas) {
      if (c === '"') {
        if (t[i + 1] === '"') { campo += '"'; i++; }
        else enComillas = false;
      } else campo += c;
    } else if (c === '"') enComillas = true;
    else if (c === sep) { fila.push(campo); campo = ''; }
    else if (c === '\n') { fila.push(campo); filas.push(fila); fila = []; campo = ''; }
    else if (c !== '\r') campo += c;
  }
  if (campo !== '' || fila.length) { fila.push(campo); filas.push(fila); }
  return filas.filter(f => f.some(x => String(x).trim() !== ''));
}

/** Detecta el separador más probable (;  ,  o tab). */
const detectarSep = linea => {
  const c = { ';': 0, ',': 0, '\t': 0 };
  for (const ch of linea) if (ch in c) c[ch]++;
  return Object.entries(c).sort((a, b) => b[1] - a[1])[0][0] || ';';
};

/** Interpreta fechas en varios formatos habituales. */
export function leerFecha(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (!s) return null;
  // dd/mm/aaaa o dd-mm-aaaa, con hora opcional
  let m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) {
    let [, d, mes, a, h = 0, mi = 0, seg = 0] = m;
    a = a.length === 2 ? '20' + a : a;
    const f = new Date(+a, +mes - 1, +d, +h, +mi, +seg);
    return isNaN(f) ? null : f;
  }
  // aaaa-mm-dd con hora opcional
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    const [, a, mes, d, h = 0, mi = 0, seg = 0] = m;
    const f = new Date(+a, +mes - 1, +d, +h, +mi, +seg);
    return isNaN(f) ? null : f;
  }
  const f = new Date(s);
  return isNaN(f) ? null : f;
}

const SI = v => /^(s[ií]|si|yes|true|1|x)$/i.test(String(v || '').trim());

/* ============ PLANTILLA ============ */
r.get('/plantilla', requiere('admin', 'gerente'), (req, res) => {
  const head = COLUMNAS.map(c => c.k).join(SEP);
  const ejemplo = COLUMNAS.map(c => esc(c.ej || '')).join(SEP);
  const ayuda = COLUMNAS.map(c => esc(c.t + (c.req ? ' (obligatorio)' : ''))).join(SEP);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="plantilla_importacion.csv"');
  res.send('\uFEFF' + [head, ayuda, ejemplo].join('\n'));
});

/* ============ EXPORTACIÓN COMPLETA ============ */
r.get('/exportar', requiere('admin', 'gerente'), async (req, res) => {
  if (!req.empresa.flags?.exportar) return res.status(403).json({ error: 'función desactivada' });
  const conMensajes = req.query.mensajes !== 'no';

  const { rows } = await q(
    `SELECT n.id, n.titulo, n.etapa, n.origen, n.valor, n.monto_cierre, n.motivo,
            n.marcadores, n.creado, n.actualizado, n.sucursal, n.linea,
            c.nombre AS cliente, c.tel, c.email, c.doc, c.ciudad, c.direccion, c.notas, c.frecuente,
            u.usuario AS responsable
       FROM negociaciones n
       JOIN contactos c ON c.id = n.contacto_id
       LEFT JOIN usuarios u ON u.id = n.agente_id
      WHERE n.empresa_id = $1
      ORDER BY n.creado`, [req.empresaId]);

  let mensajesPorNeg = {};
  if (conMensajes) {
    const { rows: ms } = await q(
      `SELECT m.negociacion_id, m.dir, m.txt, m.ts FROM mensajes m
        WHERE m.empresa_id = $1 AND COALESCE(m.txt,'') <> ''
        ORDER BY m.ts`, [req.empresaId]);
    for (const m of ms) {
      (mensajesPorNeg[m.negociacion_id] ||= []).push(`${m.dir}|${String(m.txt).replace(/[;\n\r]/g, ' ')}`);
    }
  }

  const fmt = d => d ? new Date(d).toISOString().slice(0, 16).replace('T', ' ') : '';
  const lineas = [COLUMNAS.map(c => c.k).join(SEP)];
  for (const n of rows) {
    const cerrada = ['ganado', 'cerrado'].includes(n.etapa);
    lineas.push([
      n.cliente, n.tel, n.email, n.doc, n.ciudad, n.direccion, n.notas,
      n.titulo, n.etapa, n.origen, n.responsable || '', n.sucursal, n.linea,
      n.valor, n.monto_cierre, n.motivo || '',
      fmt(n.creado), cerrada ? fmt(n.actualizado) : '',
      n.frecuente ? 'si' : 'no',
      (n.marcadores || []).join('/'),
      (mensajesPorNeg[n.id] || []).join(' ;; ')
    ].map(esc).join(SEP));
  }

  await auditar(req.empresaId, req.user.nombre, 'Exportación', `${rows.length} negociaciones`, req.ip);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition',
    `attachment; filename="iciia_${req.empresa.codigo}_${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send('\uFEFF' + lineas.join('\n'));
});

/* ============ EXPORTACIÓN DE RESPALDO (JSON) ============ */
r.get('/respaldo', requiere('admin'), async (req, res) => {
  const tablas = {};
  const consultas = {
    sucursales: 'SELECT * FROM sucursales WHERE empresa_id=$1',
    usuarios: `SELECT id,nombre,usuario,rol,sucursal,linea,equipo,email,tel,nacimiento,activo
                 FROM usuarios WHERE empresa_id=$1 AND NOT oculto`,
    contactos: 'SELECT * FROM contactos WHERE empresa_id=$1',
    negociaciones: 'SELECT * FROM negociaciones WHERE empresa_id=$1',
    mensajes: 'SELECT * FROM mensajes WHERE empresa_id=$1',
    historial: 'SELECT * FROM historial WHERE empresa_id=$1',
    transferencias: 'SELECT * FROM transferencias WHERE empresa_id=$1',
    ubicaciones: 'SELECT * FROM ubicaciones WHERE empresa_id=$1',
    eventos: 'SELECT * FROM eventos WHERE empresa_id=$1',
    rapidas: 'SELECT * FROM rapidas WHERE empresa_id=$1'
  };
  for (const [nombre, sql] of Object.entries(consultas)) {
    const { rows } = await q(sql, [req.empresaId]);
    tablas[nombre] = rows;
  }
  const { rows: emp } = await q('SELECT * FROM empresas WHERE id=$1', [req.empresaId]);
  await auditar(req.empresaId, req.user.nombre, 'Respaldo', 'Exportación JSON completa', req.ip);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition',
    `attachment; filename="respaldo_${req.empresa.codigo}_${new Date().toISOString().slice(0, 10)}.json"`);
  res.send(JSON.stringify({ version: 1, generado: new Date().toISOString(), empresa: emp[0], tablas }, null, 1));
});

/* ============ ANÁLISIS PREVIO ============ */
r.post('/analizar', requiere('admin', 'gerente'), async (req, res) => {
  const texto = String(req.body?.texto || '');
  if (!texto.trim()) return res.status(422).json({ error: 'Archivo vacío.' });

  const sep = detectarSep(texto.split('\n')[0] || '');
  const filas = parsearCSV(texto, sep);
  if (filas.length < 2) return res.status(422).json({ error: 'El archivo no tiene datos.' });

  const head = filas[0].map(h => String(h).trim().toLowerCase().replace(/\s+/g, '_'));
  const datos = filas.slice(1)
    .filter(f => !/\(obligatorio\)/i.test(f.join('')))   // descarta la fila de ayuda de la plantilla
    .map(f => Object.fromEntries(head.map((h, i) => [h, (f[i] ?? '').trim()])));

  const reconocidas = head.filter(h => COLUMNAS.some(c => c.k === h));
  const desconocidas = head.filter(h => !COLUMNAS.some(c => c.k === h));
  const faltantes = COLUMNAS.filter(c => c.req && !head.includes(c.k)).map(c => c.k);

  const etapasValidas = (req.empresa.etapas || []).map(e => e.id);
  const { rows: usuarios } = await q(
    'SELECT usuario FROM usuarios WHERE empresa_id=$1 AND activo', [req.empresaId]);
  const usuariosValidos = usuarios.map(u => u.usuario.toLowerCase());

  const avisos = [];
  const etapasRaras = new Set(), responsablesRaros = new Set();
  let sinFecha = 0, sinTel = 0;

  datos.forEach((d, i) => {
    if (!d.telefono) sinTel++;
    if (d.etapa && !etapasValidas.includes(d.etapa)) etapasRaras.add(d.etapa);
    if (d.responsable && !usuariosValidos.includes(d.responsable.toLowerCase())) responsablesRaros.add(d.responsable);
    if (d.fecha_creacion && !leerFecha(d.fecha_creacion)) sinFecha++;
  });

  if (sinTel) avisos.push(`${sinTel} fila(s) sin teléfono — se omitirán.`);
  if (etapasRaras.size) avisos.push(`Etapas no reconocidas (irán a «Contactado»): ${[...etapasRaras].join(', ')}`);
  if (responsablesRaros.size) avisos.push(`Responsables inexistentes (se asignarán por reparto): ${[...responsablesRaros].join(', ')}`);
  if (sinFecha) avisos.push(`${sinFecha} fecha(s) con formato no reconocido — se usará la fecha de hoy.`);
  if (desconocidas.length) avisos.push(`Columnas ignoradas: ${desconocidas.join(', ')}`);

  res.json({
    total: datos.length, separador: sep === '\t' ? 'tabulación' : sep,
    reconocidas, desconocidas, faltantes, avisos,
    muestra: datos.slice(0, 5),
    etapasValidas, usuariosValidos
  });
});

/* ============ IMPORTACIÓN ============ */
r.post('/importar', requiere('admin', 'gerente'), async (req, res) => {
  if (!req.empresa.flags?.importar) return res.status(403).json({ error: 'función desactivada' });
  const emp = req.empresa;
  const texto = String(req.body?.texto || '');
  const opciones = req.body?.opciones || {};
  if (!texto.trim()) return res.status(422).json({ error: 'Archivo vacío.' });

  const sep = detectarSep(texto.split('\n')[0] || '');
  const filas = parsearCSV(texto, sep);
  const head = filas[0].map(h => String(h).trim().toLowerCase().replace(/\s+/g, '_'));
  if (!head.includes('telefono') && !head.includes('cliente')) {
    return res.status(422).json({ error: 'El archivo debe tener al menos las columnas «cliente» y «telefono».' });
  }
  const datos = filas.slice(1)
    .filter(f => !/\(obligatorio\)/i.test(f.join('')))
    .map(f => Object.fromEntries(head.map((h, i) => [h, (f[i] ?? '').trim()])));

  /* Catálogos para resolver referencias */
  const { rows: usuarios } = await q(
    'SELECT id, usuario, nombre, sucursal, linea FROM usuarios WHERE empresa_id=$1 AND activo', [req.empresaId]);
  const porUsuario = new Map(usuarios.map(u => [u.usuario.toLowerCase(), u]));
  const porNombre = new Map(usuarios.map(u => [u.nombre.toLowerCase(), u]));
  const { rows: sucs } = await q('SELECT nombre FROM sucursales WHERE empresa_id=$1', [req.empresaId]);
  const sucursales = sucs.map(s => s.nombre);
  const etapasValidas = (emp.etapas || []).map(e => e.id);
  const etapaPorNombre = new Map((emp.etapas || []).map(e => [e.nombre.toLowerCase(), e.id]));

  const resultado = { contactosNuevos: 0, contactosActualizados: 0, negociaciones: 0, mensajes: 0, omitidas: 0, errores: [] };

  for (const [i, d] of datos.entries()) {
    const linea = i + 2;
    try {
      const tel = (d.telefono || '').trim();
      const nombre = (d.cliente || '').trim() || (tel ? `Contacto ${tel.slice(-4)}` : '');
      if (!tel && !nombre) { resultado.omitidas++; continue; }

      /* --- contacto --- */
      let contacto = null;
      if (tel) {
        const { rows } = await q(
          'SELECT * FROM contactos WHERE empresa_id=$1 AND tel_norm=$2 LIMIT 1', [req.empresaId, telNorm(tel)]);
        contacto = rows[0] || null;
      }
      const sucursal = sucursales.includes(d.sucursal) ? d.sucursal : (sucursales[0] || 'Central');
      const resp = porUsuario.get((d.responsable || '').toLowerCase())
        || porNombre.get((d.responsable || '').toLowerCase()) || null;

      if (!contacto) {
        contacto = await crearContacto(emp, {
          nombre, tel, email: d.email, doc: d.documento, ciudad: d.ciudad,
          direccion: d.direccion, notas: d.notas, sucursal,
          linea: d.linea || (emp.lineas || [])[0] || '',
          responsable_id: resp?.id || null,
          externos: tel ? { whatsapp: tel.replace(/\D/g, '') } : {}
        });
        if (SI(d.frecuente)) await q('UPDATE contactos SET frecuente=TRUE WHERE id=$1', [contacto.id]);
        resultado.contactosNuevos++;
      } else {
        await q(
          `UPDATE contactos SET nombre=COALESCE(NULLIF($3,''),nombre), email=COALESCE(NULLIF($4,''),email),
             doc=COALESCE(NULLIF($5,''),doc), ciudad=COALESCE(NULLIF($6,''),ciudad),
             direccion=COALESCE(NULLIF($7,''),direccion), notas=COALESCE(NULLIF($8,''),notas),
             frecuente = frecuente OR $9
           WHERE id=$1 AND empresa_id=$2`,
          [contacto.id, req.empresaId, nombre, d.email || '', d.documento || '', d.ciudad || '',
           d.direccion || '', d.notas || '', SI(d.frecuente)]);
        resultado.contactosActualizados++;
      }

      if (opciones.soloContactos) continue;

      /* --- etapa --- */
      let etapa = (d.etapa || '').trim().toLowerCase();
      if (!etapasValidas.includes(etapa)) etapa = etapaPorNombre.get(etapa) || opciones.etapaPorDefecto || 'contactado';

      /* --- anti duplicado --- */
      if (emp.flags?.antiDuplicado && etapaActiva(emp, etapa)) {
        const { rows: dup } = await q(
          `SELECT n.id FROM negociaciones n WHERE n.empresa_id=$1 AND n.contacto_id=$2
             AND n.etapa = ANY($3) LIMIT 1`,
          [req.empresaId, contacto.id, etapasValidas.filter(e => etapaActiva(emp, e))]);
        if (dup.length) {
          if (opciones.duplicados === 'omitir') { resultado.omitidas++; continue; }
          etapa = 'cerrado';   // la importa como histórico para no romper la regla
        }
      }

      const creado = leerFecha(d.fecha_creacion) || new Date();
      const cerrado = leerFecha(d.fecha_cierre);
      const agente = resp?.id || (opciones.asignarSinResponsable ? await asignarEquitativo(emp, { sucursal }) : null);
      const marcadores = String(d.marcadores || '').split(/[/,|]/).map(x => x.trim()).filter(Boolean);
      if (opciones.marcarImportadas && !marcadores.includes('importado')) marcadores.push('importado');

      const { rows: ns } = await q(
        `INSERT INTO negociaciones
           (empresa_id,contacto_id,titulo,etapa,origen,agente_id,sucursal,linea,valor,monto_cierre,
            motivo,marcadores,bot_activo,creado,actualizado,entrada_etapa)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,FALSE,$13,$14,$13) RETURNING id`,
        [req.empresaId, contacto.id, d.titulo || 'Importada', etapa, (d.origen || 'otro').toLowerCase(),
         agente, sucursal, d.linea || contacto.linea,
         Number(String(d.valor || '0').replace(/\D/g, '')) || 0,
         Number(String(d.monto_cierre || '0').replace(/\D/g, '')) || 0,
         d.motivo || null, JSON.stringify(marcadores), creado, cerrado || creado]);
      const negId = ns[0].id;
      resultado.negociaciones++;

      /* --- conversación --- */
      if (d.mensajes) {
        const partes = String(d.mensajes).split(';;').map(x => x.trim()).filter(Boolean);
        let t = new Date(creado);
        for (const p of partes) {
          const m = p.match(/^(in|out|cliente|agente)\s*\|\s*([\s\S]+)$/i);
          const dir = m ? (/^(in|cliente)$/i.test(m[1]) ? 'in' : 'out') : 'in';
          const txt = m ? m[2] : p;
          await q(
            `INSERT INTO mensajes (empresa_id,negociacion_id,dir,txt,ts) VALUES ($1,$2,$3,$4,$5)`,
            [req.empresaId, negId, dir, txt.slice(0, 4000), t]);
          t = new Date(t.getTime() + 60000);
          resultado.mensajes++;
        }
      }

      await historial(req.empresaId, negId,
        `Importada desde archivo externo · fecha original ${creado.toLocaleString('es-PY')}`, req.user.nombre);
    } catch (e) {
      resultado.errores.push({ linea, error: e.message });
      if (resultado.errores.length > 50) {
        resultado.errores.push({ linea: 0, error: 'Se detuvo el registro de errores (más de 50).' });
        break;
      }
    }
  }

  await auditar(req.empresaId, req.user.nombre, 'Importación',
    `${resultado.negociaciones} negociaciones · ${resultado.contactosNuevos} contactos nuevos`, req.ip);
  emitir(req.empresaId, 'neg:recargar', {});
  res.json({ ok: true, ...resultado });
});

/* ============ COLUMNAS (para la ayuda del front) ============ */
r.get('/columnas', requiere('admin', 'gerente'), (req, res) => res.json(COLUMNAS));

export default r;
