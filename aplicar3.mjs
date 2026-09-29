#!/usr/bin/env node
/**
 * Parche 3 · iciia2.0 — envío de mensajes
 *  - Nunca marca "enviado" si no se encoló de verdad (antes pasaba en silencio)
 *  - Verifica que el número exista en WhatsApp antes de enviar
 *  - Responde al mismo chat del que escribió el cliente (soporte LID)
 *  - No gasta reintentos mientras la línea está desconectada
 *  - Avisa al agente y deja el motivo en el historial cuando falla
 * Requiere los parches 1 y 2. Uso:  node aplicar3.mjs && pm2 restart iciia-crm
 */
import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';

const R = process.cwd();
const cambios = [];   // se escribe todo junto al final, solo si no hubo errores
let errores = 0, ya = 0;
const leer = rel => existsSync(join(R, rel)) ? readFileSync(join(R, rel), 'utf8') : null;

function editar(rel, marca, pasos) {
  let s = leer(rel);
  if (s === null) { console.error(`  ✖ no existe ${rel}`); errores++; return; }
  if (s.includes(marca)) { console.log(`  · ${rel}: ya aplicado`); ya++; return; }
  for (const [viejo, nuevo, etiqueta] of pasos) {
    if (!s.includes(viejo)) { console.error(`  ✖ ${rel}: no se encontró «${etiqueta}»`); errores++; return; }
    s = s.split(viejo).join(nuevo);
  }
  cambios.push([rel, s]);
  console.log(`  ✔ ${rel}`);
}

console.log('\n══ Parche 3 · envío de mensajes ══\n');
if (!(leer('src/db.mjs') || '').includes('TELNORM_PY') || !(leer('src/channels/baileys.mjs') || '').includes('SOPORTE_LID')) {
  console.error('✖ Primero hay que aplicar el parche 2 (node aplicar2.mjs).\n'); process.exit(1);
}

/* 1. Baileys: guardar el chat de origen y verificar el número al enviar */
editar('src/channels/baileys.mjs', 'ENVIO_V3', [
  ["JSON.stringify({ ts: Number(m.messageTimestamp) * 1000, archivoId: media?.id || null })",
   "JSON.stringify({ ts: Number(m.messageTimestamp) * 1000, archivoId: media?.id || null,\n       jid: m.key.senderPn || m.key.remoteJidAlt || jid /* ENVIO_V3 */ })",
   'payload del inbox'],
  ["  const jid = String(destino).includes('@') ? String(destino) : `${num}@s.whatsapp.net`;",
   `  let jid;
  if (String(destino).includes('@')) jid = String(destino);
  else {
    num = num.replace(/^0+/, '');
    if (!num.startsWith(prefijo) && num.length <= 10) num = prefijo + num;
    let existe = null;
    try { const [r] = await S.sock.onWhatsApp(num); existe = r || { exists: false }; }
    catch (e) { existe = null; }   // si la consulta falla, se intenta igual
    if (existe && !existe.exists) {
      const err = new Error(\`El número +\${num} no tiene WhatsApp\`); err.permanente = true; throw err;
    }
    jid = existe?.jid || \`\${num}@s.whatsapp.net\`;
  }`, 'armado del destino']
]);

/* 2. Worker */
editar('src/worker.mjs', 'ENVIO_V3', [
  ["import { ingresarMensaje, notificar } from './core.mjs';",
   "import { ingresarMensaje, notificar, historial } from './core.mjs';\nimport { emitir } from './realtime.mjs';   // ENVIO_V3", 'imports'],
  ["        await ingresarMensaje(empresa, {", "        const resIng = await ingresarMensaje(empresa, {", 'ingreso'],
  ["        await q(`UPDATE inbox SET estado='procesado', procesado=now(), error=NULL WHERE id=$1`, [m.id]);",
   `        if (m.payload?.jid && resIng?.contacto?.id) {
          await q(\`UPDATE contactos SET externos = externos || jsonb_build_object('wa_jid', $2::text) WHERE id=$1\`,
            [resIng.contacto.id, m.payload.jid]);
        }
        await q(\`UPDATE inbox SET estado='procesado', procesado=now(), error=NULL WHERE id=$1\`, [m.id]);`, 'guardar chat de origen'],
  ["      if (!o.canal_id) throw new Error('mensaje sin canal asignado');",
   `      if (!o.canal_id) throw new Error('mensaje sin canal asignado');
      // Con la línea caída no se gasta el reintento: queda esperando la reconexión
      if (o.tipo === 'whatsapp_qr' && baileys.estadoSesion(o.canal_id).estado !== 'conectado') continue;`, 'espera de reconexión'],
  ["      if (o.negociacion_id) await marcar(o, 'ok');",
   "      if (o.negociacion_id) { await marcar(o, 'ok'); emitir(o.c_emp, 'neg:patch', { id: o.negociacion_id }); }", 'aviso de enviado'],
  ["      const agotado = intentos >= MAX_ENVIOS;",
   "      const agotado = e.permanente || intentos >= MAX_ENVIOS;", 'error definitivo'],
  ["      if (agotado && o.negociacion_id) await marcar(o, 'error');",
   `      if (agotado && o.negociacion_id) {
        await marcar(o, 'error');
        await historial(o.c_emp || o.empresa_id, o.negociacion_id, \`⚠ Mensaje no entregado: \${e.message}\`, 'Sistema');
        const { rows: au } = await q(
          \`SELECT autor_id FROM mensajes WHERE negociacion_id=$1 AND dir='out' AND autor_id IS NOT NULL ORDER BY ts DESC LIMIT 1\`,
          [o.negociacion_id]);
        emitir(o.c_emp || o.empresa_id, 'noti', { titulo: 'Mensaje no enviado', msg: e.message, tono: 'bad', ref: o.negociacion_id },
          au[0] ? [au[0].autor_id] : undefined);
        emitir(o.c_emp || o.empresa_id, 'neg:patch', { id: o.negociacion_id });
      }`, 'aviso de fallo']
]);

/* 3. Encolado: nada de "enviado" falso */
editar('src/routes/negociaciones.mjs', 'ENVIO_V3', [
  ["    `SELECT * FROM canales WHERE empresa_id=$1 AND activo AND ($2::uuid IS NULL OR id=$2)\n      ORDER BY (id=$2) DESC LIMIT 1`, [req.empresaId, n.canal_id]);",
   "    `SELECT * FROM canales WHERE empresa_id=$1 AND activo\n      ORDER BY (id = $2::uuid) IS TRUE DESC, (tipo LIKE 'whatsapp%') DESC, (estado = 'conectado') DESC, creado\n      LIMIT 1`, [req.empresaId, n.canal_id]);   // ENVIO_V3",
   'elección de canal'],
  ["    ? (canal.tipo.startsWith('whatsapp') ? (c.externos?.whatsapp || c.tel)",
   "    ? (canal.tipo.startsWith('whatsapp')\n        ? ((canal.tipo === 'whatsapp_qr' && c.externos?.wa_jid) || c.tel || c.externos?.whatsapp)",
   'destino'],
  ["  const estado = canal && destino ? 'pendiente' : 'ok';",
   `  const motivoNoEnvio = !canal ? 'No hay ningún canal activo para enviar este mensaje.'
    : !destino ? 'El cliente no tiene número o identificador para este canal.' : null;
  const estado = motivoNoEnvio ? 'error' : 'pendiente';`, 'estado'],
  ["  await historial(req.empresaId, n.id, adjunto ? `Adjunto enviado: ${adjunto.nombre}` : 'Mensaje enviado', req.user.nombre);",
   "  await historial(req.empresaId, n.id, motivoNoEnvio ? `⚠ No se pudo enviar: ${motivoNoEnvio}`\n    : (adjunto ? `Adjunto en cola: ${adjunto.nombre}` : 'Mensaje en cola de envío'), req.user.nombre);",
   'historial'],
  ["  if (canal && destino) {", "  if (!motivoNoEnvio) {", 'condición de encolado'],
  ["       adjunto?.url || null, adjunto?.tipo || null, adjunto?.nombre || null]);\n  }\n}",
   "       adjunto?.url || null, adjunto?.tipo || null, adjunto?.nombre || null]);\n  }\n  return motivoNoEnvio;\n}",
   'retorno'],
  ["  await encolarSalida(req, n, texto, adjunto);\n  emitir(req.empresaId, 'neg:patch', { id: n.id });\n  res.json({ ok: true });",
   "  const aviso = await encolarSalida(req, n, texto, adjunto);\n  emitir(req.empresaId, 'neg:patch', { id: n.id });\n  res.json({ ok: true, aviso });",
   'respuesta']
]);

/* 4. Ficha: avisar en el momento */
editar('public/js/ficha.js', 'ENVIO_V3', [
  ["        await post(`/negociaciones/${n.id}/mensajes`, { texto: txt, archivoId });",
   "        const rEnv = await post(`/negociaciones/${n.id}/mensajes`, { texto: txt, archivoId });   // ENVIO_V3\n        if (rEnv?.aviso) toast(rEnv.aviso, 'bad', 'Mensaje no enviado');",
   'envío desde la ficha']
]);

console.log(`\n${'─'.repeat(44)}`);
if (errores) {
  console.error(`  ✖ ${errores} error(es). No se modificó ningún archivo.\n  Pegá esta salida para revisarla.\n`);
  process.exit(1);
}
for (const [rel, s] of cambios) {
  const p = join(R, rel);
  if (!existsSync(p + '.orig3')) copyFileSync(p, p + '.orig3');
  writeFileSync(p, s, 'utf8');
}
console.log(`  ${cambios.length} archivo(s) modificados · ${ya} ya estaban`);
console.log(`${'─'.repeat(44)}\n\n✔ Listo. Ahora:  pm2 restart iciia-crm\n`);
