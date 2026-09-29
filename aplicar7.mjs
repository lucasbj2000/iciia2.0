#!/usr/bin/env node
/**
 * Parche 7 · iciia2.0 — cliente que vuelve y re gestión
 *  - Etapas abiertas fijas: Nuevo, Contactado y Espera. Las de cierre nunca cuentan
 *    como abiertas, aunque se haya tocado el interruptor «Activa» en la configuración.
 *  - Cliente con todo cerrado que escribe → negociación nueva en «Cliente espera respuesta».
 *  - Re gestión desde una cerrada: si el cliente tiene una abierta, el mensaje va ahí
 *    (y se muestra); si no, se crea una nueva. Nunca más «ya existe una activa» sin mostrarla.
 *  - Bloqueo por cliente para que dos mensajes simultáneos no choquen.
 *  - Recupera los mensajes que quedaron atrapados en negociaciones cerradas o en cuarentena.
 * Requiere los parches 2 al 5. Uso:  node aplicar7.mjs && pm2 restart iciia-crm
 */
import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';

const R = process.cwd();
const cambios = [];
let errores = 0, ya = 0;
const leer = rel => existsSync(join(R, rel)) ? readFileSync(join(R, rel), 'utf8') : null;
const falla = m => { console.error('  ✖ ' + m); errores++; return null; };

function editar(rel, marca, pasos) {
  let s = leer(rel);
  if (s === null) return falla(`no existe ${rel}`);
  if (s.includes(marca)) { console.log(`  · ${rel}: ya aplicado`); ya++; return; }
  for (const paso of pasos) {
    if (typeof paso === 'function') { const r = paso(s); if (r === null) return; s = r; continue; }
    const [viejo, nuevo, etiqueta] = paso;
    if (!s.includes(viejo)) return falla(`${rel}: no se encontró «${etiqueta}»`);
    s = s.split(viejo).join(nuevo);
  }
  cambios.push([rel, s]);
  console.log(`  ✔ ${rel}`);
}
/** Reemplaza el bloque que va desde `inicio` hasta justo antes de `fin`. */
const bloque = (rel, inicio, fin, nuevo) => s => {
  const a = s.indexOf(inicio);
  const b = a < 0 ? -1 : s.indexOf(fin, a + inicio.length);
  if (a < 0 || b < 0) return falla(`${rel}: no se encontró el bloque «${inicio.slice(0, 40)}…»`);
  return s.slice(0, a) + nuevo + '\n\n' + s.slice(b);
};

console.log('\n══ Parche 7 · cliente que vuelve y re gestión ══\n');
if (!existsSync(join(R, 'src/migrations/005_etapas_fijas.sql'))) {
  console.error('✖ Falta copiar src/migrations/005_etapas_fijas.sql\n'); process.exit(1);
}
const core0 = leer('src/core.mjs') || '';
// Si el parche ya está aplicado, las marcas de los parches anteriores ya no están (se reemplazó esa función)
const req = core0.includes('INGRESO_V7') ? []
  : [['TEL_SIN_LID', 2], ['programarBot', 4], ['CLIENTE_QUE_VUELVE', 5]].filter(([m]) => !core0.includes(m));
if (req.length) { console.error(`✖ Primero hay que aplicar el parche ${req.map(r => r[1]).join(', ')}.\n`); process.exit(1); }

/* ============ 1. core.mjs ============ */
const INGRESO = `export async function ingresarMensaje(empresa, {
  canalId, canalSucursal, canalLinea, origen, extId, remitente, nombre, texto,
  mediaUrl, mediaTipo, mediaNombre, archivoId, ubicacion, ts, externoTipo
}) {
  /* INGRESO_V7 */
  if (extId) {
    const { rows } = await q('SELECT 1 FROM mensajes WHERE empresa_id=$1 AND msg_id=$2 LIMIT 1', [empresa.id, extId]);
    if (rows.length) return { duplicado: true };
  }
  const cuando = ts ? new Date(ts) : new Date();
  const conTelefono = origen === 'whatsapp' && !String(remitente).includes('@');
  const criterio = { tel: conTelefono ? remitente : null, externoTipo: externoTipo || origen, externoId: remitente };

  /* --- contacto --- */
  let contacto = await buscarContacto(empresa, criterio);
  const reingreso = !!contacto;
  if (!contacto) {
    try {
      contacto = await crearContacto(empresa, {
        nombre: nombre || etiquetaAnonima(origen, remitente),
        tel: conTelefono ? remitente : '',
        sucursal: canalSucursal || null, linea: canalLinea || null,
        externos: { [externoTipo || origen]: String(remitente) }
      });
    } catch (e) {
      // Otro mensaje del mismo cliente lo creó al mismo tiempo
      contacto = e.code === '23505' ? await buscarContacto(empresa, criterio) : null;
      if (!contacto) throw e;
    }
  } else {
    const ext = contacto.externos || {};
    const key = externoTipo || origen;
    if (!ext[key]) {
      ext[key] = String(remitente);
      await q('UPDATE contactos SET externos=$2 WHERE id=$1', [contacto.id, JSON.stringify(ext)]);
    }
    if (nombre && /^(WhatsApp|Messenger|Instagram|Contacto) /.test(contacto.nombre)) {
      await q('UPDATE contactos SET nombre=$2 WHERE id=$1', [contacto.id, nombre]);
      contacto.nombre = nombre;
    }
  }

  /* --- ubicación --- */
  let det = null;
  if (empresa.flags?.detectarUbicacion) {
    if (ubicacion?.lat != null) {
      det = { fuente: 'gps', confianza: 'alta', lat: ubicacion.lat, lon: ubicacion.lon,
        texto: ubicacion.nombre || ubicacion.direccion || '', direccion: ubicacion.direccion || '' };
    } else if (texto) det = ubi.detectar(texto);
  }

  /* --- negociación: la abierta, o una nueva si todas están cerradas --- */
  const { neg, reusada, extra } = await conNegociacion(empresa, contacto.id, async c => {
    const { rows: prev } = await c.query('SELECT COUNT(*)::int AS n FROM negociaciones WHERE contacto_id=$1', [contacto.id]);
    const vuelve = prev[0].n > 0;   // ya tuvo negociaciones y están todas cerradas
    const agente = await asignarEquitativo(empresa, { sucursal: canalSucursal, linea: canalLinea });
    const marcadores = (reingreso || vuelve) && empresa.flags?.marcadorFrecuente ? ['frecuente'] : [];
    const { rows } = await c.query(
      \`INSERT INTO negociaciones
         (empresa_id,contacto_id,titulo,etapa,origen,canal_id,agente_id,sucursal,linea,marcadores,bot_activo,creado,actualizado,entrada_etapa)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now(),now()) RETURNING *\`,
      [empresa.id, contacto.id, vuelve ? 'Cliente vuelve a comunicarse' : 'Contacto entrante', vuelve ? 'espera' : 'nuevo',
       origen, canalId || null, agente, canalSucursal || contacto.sucursal, canalLinea || contacto.linea,
       JSON.stringify(marcadores), !!(empresa.flags?.bot && empresa.bot?.activo), cuando]);
    if (marcadores.length) await c.query('UPDATE contactos SET frecuente=TRUE WHERE id=$1', [contacto.id]);
    return rows[0];
  }, async (c, n, esAbierta) => {
    await c.query(
      \`INSERT INTO mensajes (empresa_id,negociacion_id,dir,txt,media_url,media_tipo,media_nombre,archivo_id,ubicacion,msg_id,ts)
       VALUES ($1,$2,'in',$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING\`,
      [empresa.id, n.id, texto || '', mediaUrl || null, mediaTipo || null, mediaNombre || null,
       archivoId || null, ubicacion ? JSON.stringify(ubicacion) : null, extId || null, cuando]);
    if (!esAbierta) return { pasoAEspera: false };
    const pasoAEspera = n.etapa !== 'espera';
    // Si la abierta no tiene responsable activo, se le asigna uno para que alguien la vea
    const { rows: ag } = await c.query('SELECT activo FROM usuarios WHERE id=$1', [n.agente_id]);
    let agente = n.agente_id;
    if (!agente || !ag[0]?.activo) agente = (await asignarEquitativo(empresa, { sucursal: n.sucursal, linea: n.linea })) || agente;
    await c.query(
      \`UPDATE negociaciones SET agente_id=$2, actualizado=now(),
         etapa = 'espera',
         entrada_etapa = CASE WHEN etapa <> 'espera' THEN now() ELSE entrada_etapa END,
         aviso_sla = CASE WHEN etapa <> 'espera' THEN FALSE ELSE aviso_sla END
       WHERE id=$1\`, [n.id, agente]);
    n.agente_id = agente;
    return { pasoAEspera };
  });

  if (reusada) {
    if (extra.pasoAEspera) {
      await historial(empresa.id, neg.id, \`Cliente respondió por \${origen} → Cliente espera una respuesta\`, 'Sistema');
      await notificar(empresa, 'retorno', { cliente: contacto.nombre }, [neg.agente_id], neg.id);
    }
    if (neg.bot_activo && empresa.flags?.bot && empresa.bot?.activo) programarBot(empresa, neg.id);
    if (det) await guardarUbicacion(empresa, contacto, neg, det);
    emitir(empresa.id, 'neg:patch', { id: neg.id });
    return { negociacionId: neg.id, reusada: true, contacto };
  }

  await historial(empresa.id, neg.id,
    (neg.etapa === 'espera' ? \`El cliente volvió a escribir por \${origen}: nueva negociación\` : \`Ingreso automático por \${origen}\`)
    + (neg.agente_id ? ' · asignado por reparto equitativo' : ' · sin agentes disponibles'), 'Sistema');
  await notificar(empresa, 'nuevo', { cliente: contacto.nombre, origen }, [neg.agente_id], neg.id);
  if (empresa.flags?.bot && empresa.bot?.activo) programarBot(empresa, neg.id);
  if (det) await guardarUbicacion(empresa, contacto, neg, det);
  emitir(empresa.id, 'neg:nueva', { id: neg.id });
  return { negociacionId: neg.id, contacto };
}

/**
 * Busca la negociación abierta del cliente o la crea, con un bloqueo por cliente:
 * dos mensajes simultáneos no pueden generar dos negociaciones ni chocar entre sí.
 * \`usar(c, neg, esAbierta)\` corre dentro de la misma transacción.
 */
export async function conNegociacion(empresa, contactoId, crear, usar) {
  return tx(async c => {
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1::text))', [String(contactoId)]);
    const { rows } = await c.query(
      \`SELECT * FROM negociaciones WHERE contacto_id=$1 AND etapa = ANY($2::text[])
        ORDER BY creado LIMIT 1 FOR UPDATE\`, [contactoId, ETAPAS_ABIERTAS]);
    const reusada = !!rows[0];
    const neg = rows[0] || await crear(c);
    const extra = usar ? await usar(c, neg, reusada) : null;
    return { neg, reusada, extra: extra || {} };
  });
}`;

editar('src/core.mjs', 'INGRESO_V7', [
  ["import { q, telNorm } from './db.mjs';", "import { q, tx, telNorm } from './db.mjs';", 'import de la base'],
  ["export const etapasActivas = emp => (emp.etapas || []).filter(e => e.activa).map(e => e.id);\nexport function etapaActiva(emp, id) { const e = (emp.etapas || []).find(x => x.id === id); return e ? !!e.activa : false; }",
   `/* ETAPAS_FIJAS — las abiertas son siempre estas tres; las de cierre nunca cuentan como abiertas */
export const ETAPAS_ABIERTAS = ['nuevo', 'contactado', 'espera'];
export const etapasActivas = () => ETAPAS_ABIERTAS;
export function etapaActiva(_emp, id) { return ETAPAS_ABIERTAS.includes(id); }`, 'definición de etapas activas'],
  bloque('src/core.mjs', 'export async function ingresarMensaje(', 'async function guardarUbicacion(', INGRESO)
]);

/* ============ 2. Re gestión ============ */
const REGESTION = `r.post('/:id/regestionar', requiere(), async (req, res) => {   // REGESTION_V7
  const emp = req.empresa;
  const texto = String(req.body?.texto || '').trim();
  const archivoId = req.body?.archivoId || null;
  if (!texto && !archivoId) return res.status(422).json({ error: 'Escribí un mensaje o adjuntá un archivo.' });
  const adjunto = archivoId ? await obtenerArchivo(archivoId, req.empresaId) : null;
  if (archivoId && !adjunto) return res.status(404).json({ error: 'El archivo adjunto no existe.' });

  const { rows } = await q('SELECT * FROM negociaciones WHERE id=$1 AND empresa_id=$2', [req.params.id, req.empresaId]);
  const o = rows[0];
  if (!o) return res.status(404).json({ error: 'no encontrada' });
  const quienEscribe = ['agente', 'jefe'].includes(req.user.rol) ? req.user.id : null;

  const { neg, reusada } = await conNegociacion(emp, o.contacto_id, async c => {
    const marcadores = [];
    if (emp.flags?.marcadorRegestion) marcadores.push('regestionado');
    if (emp.flags?.marcadorFrecuente) marcadores.push('frecuente');
    const agente = quienEscribe || o.agente_id || await asignarEquitativo(emp, { sucursal: o.sucursal });
    const { rows: ns } = await c.query(
      \`INSERT INTO negociaciones (empresa_id,contacto_id,titulo,etapa,origen,canal_id,agente_id,sucursal,linea,marcadores,bot_activo)
       VALUES ($1,$2,$3,'contactado',$4,$5,$6,$7,$8,$9,FALSE) RETURNING *\`,
      [req.empresaId, o.contacto_id, \`Re gestión · \${o.titulo || ''}\`.slice(0, 200), o.origen, o.canal_id,
       agente, o.sucursal, o.linea, JSON.stringify(marcadores)]);
    return ns[0];
  }, async (c, n, esAbierta) => {
    if (!esAbierta) return;
    // El cliente ya tenía una abierta: el mensaje va ahí y queda a cargo de quien escribe si nadie la atendía
    const { rows: ag } = await c.query('SELECT activo FROM usuarios WHERE id=$1', [n.agente_id]);
    const agente = (!n.agente_id || !ag[0]?.activo)
      ? (quienEscribe || await asignarEquitativo(emp, { sucursal: n.sucursal }) || n.agente_id) : n.agente_id;
    await c.query(
      \`UPDATE negociaciones SET agente_id=$2, bot_activo=FALSE, actualizado=now(),
         etapa = CASE WHEN etapa IN ('nuevo','espera') THEN 'contactado' ELSE etapa END,
         entrada_etapa = CASE WHEN etapa IN ('nuevo','espera') THEN now() ELSE entrada_etapa END,
         aviso_sla = CASE WHEN etapa IN ('nuevo','espera') THEN FALSE ELSE aviso_sla END
       WHERE id=$1\`, [n.id, agente]);
    n.agente_id = agente;
  });

  await q('UPDATE contactos SET frecuente=TRUE WHERE id=$1 AND empresa_id=$2', [o.contacto_id, req.empresaId]);
  await historial(req.empresaId, neg.id, reusada
    ? '✉ Mensaje enviado desde una negociación cerrada: se agregó a esta conversación abierta'
    : \`Nueva negociación por re contacto desde \${nombreEtapa(emp, o.etapa)} · bot desactivado\`, req.user.nombre);
  await historial(req.empresaId, o.id, reusada
    ? 'Cliente re contactado · el mensaje se sumó a su negociación abierta'
    : 'Cliente re contactado · se generó nueva negociación', req.user.nombre);
  const aviso = await encolarSalida(req, neg, texto, adjunto);
  emitir(req.empresaId, reusada ? 'neg:patch' : 'neg:nueva', { id: neg.id });

  const { rows: fin } = await q(
    \`SELECT n.etapa, u.nombre AS agente FROM negociaciones n LEFT JOIN usuarios u ON u.id=n.agente_id WHERE n.id=$1\`, [neg.id]);
  res.json({ ok: true, id: neg.id, reusada, etapa: nombreEtapa(emp, fin[0]?.etapa), agente: fin[0]?.agente || null, aviso: aviso || null });
});`;

editar('src/routes/negociaciones.mjs', 'REGESTION_V7', [
  ["import { emitir } from '../realtime.mjs';",
   "import { emitir } from '../realtime.mjs';\nimport { conNegociacion } from '../core.mjs';", 'imports'],
  bloque('src/routes/negociaciones.mjs', "r.post('/:id/regestionar'", 'async function encolarSalida(', REGESTION)
]);

/* ============ 3. Configuración de etapas: las del sistema no se pueden alterar ============ */
editar('src/routes/admin.mjs', 'ETAPAS_FIJAS', [
  ["  await q('UPDATE empresas SET etapas=$2 WHERE id=$1', [req.empresaId, JSON.stringify(req.body?.etapas || [])]);",
   `  /* ETAPAS_FIJAS — las etapas del sistema conservan siempre su condición de abierta o cerrada */
  const SISTEMA = { nuevo: true, contactado: true, espera: true, ganado: false, cerrado: false };
  const etapas = (Array.isArray(req.body?.etapas) ? req.body.etapas : [])
    .map(e => (e && e.id in SISTEMA) ? { ...e, activa: SISTEMA[e.id], sistema: true } : e);
  await q('UPDATE empresas SET etapas=$2 WHERE id=$1', [req.empresaId, JSON.stringify(etapas)]);`, 'guardado de etapas']
]);

/* ============ 4. Ficha: mostrar dónde quedó el mensaje ============ */
editar('public/js/ficha.js', 'REGESTION_V7', [
  ["        const r = await post(`/negociaciones/${n.id}/regestionar`, { texto: txt, archivoId });\n        cerrar(); toast('Nueva negociación en Contactado', 'ok', 'Re gestionado');\n        patchTarjeta(r.id, { nueva: true });",
   `        const r = await post(\`/negociaciones/\${n.id}/regestionar\`, { texto: txt, archivoId });   // REGESTION_V7
        if (r.aviso) toast(r.aviso, 'bad', 'Mensaje no enviado');
        toast(r.reusada
          ? \`El cliente ya tenía una conversación abierta (\${r.etapa}\${r.agente ? ' · ' + r.agente : ''}). Tu mensaje se agregó ahí.\`
          : 'Nueva negociación en Contactado', 'ok', 'Re gestionado');
        patchTarjeta(r.id, r.reusada ? { destacar: true } : { nueva: true });
        fichaNeg(r.id);`, 'envío de re gestión']
]);

console.log(`\n${'─'.repeat(46)}`);
if (errores) { console.error(`  ✖ ${errores} error(es). No se modificó ningún archivo.\n  Pegá esta salida para revisarla.\n`); process.exit(1); }
for (const [rel, s] of cambios) {
  const p = join(R, rel);
  if (!existsSync(p + '.orig7')) copyFileSync(p, p + '.orig7');
  writeFileSync(p, s, 'utf8');
}
console.log(`  ${cambios.length} archivo(s) modificados · ${ya} ya estaban`);
console.log(`${'─'.repeat(46)}\n\n✔ Listo. Ahora:  pm2 restart iciia-crm`);
console.log('  Al arrancar se recuperan los mensajes que habían quedado atrapados.\n');
