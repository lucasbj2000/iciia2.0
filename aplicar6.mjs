#!/usr/bin/env node
/**
 * Parche 6 · iciia2.0 — clientes que WhatsApp identifica con LID
 *  - Traduce el identificador LID al teléfono real cuando WhatsApp lo permite
 *  - Guarda el LID en el contacto para reconocerlo la próxima vez
 *  - Busca al cliente también por ese identificador (no crea un contacto nuevo)
 * Requiere los parches 2 y 3. Uso:  node aplicar6.mjs && pm2 restart iciia-crm
 */
import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';

const R = process.cwd();
const cambios = [];
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
  cambios.push([rel, s]); console.log(`  ✔ ${rel}`);
}

console.log('\n══ Parche 6 · WhatsApp LID ══\n');
if (!(leer('src/worker.mjs') || '').includes('ENVIO_V3')) { console.error('✖ Primero hay que aplicar el parche 3.\n'); process.exit(1); }

editar('src/channels/baileys.mjs', 'LID_A_TELEFONO', [
  ["    remitenteNum = alt ? alt.split('@')[0] : jid;",
   `    let pn = alt;
    /* LID_A_TELEFONO — pedirle a WhatsApp el teléfono que corresponde a ese LID */
    if (!pn) {
      try {
        const rep = sesiones.get(id)?.sock?.signalRepository?.lidMapping;
        pn = (await rep?.getPNForLID?.(jid)) || '';
      } catch (e) { pn = ''; }
    }
    remitenteNum = pn ? String(pn).split('@')[0].split(':')[0] : jid;`, 'resolución del LID'],
  ["jid: m.key.senderPn || m.key.remoteJidAlt || jid /* ENVIO_V3 */ })",
   "jid: m.key.senderPn || m.key.remoteJidAlt || jid /* ENVIO_V3 */,\n       lid: jid.endsWith('@lid') ? jid : null })", 'guardar el LID']
]);

editar('src/worker.mjs', 'GUARDA_LID', [
  ["          await q(`UPDATE contactos SET externos = externos || jsonb_build_object('wa_jid', $2::text) WHERE id=$1`,\n            [resIng.contacto.id, m.payload.jid]);",
   "          await q(`UPDATE contactos SET externos = externos || jsonb_strip_nulls(jsonb_build_object('wa_jid', $2::text, 'lid', $3::text)) WHERE id=$1`,   // GUARDA_LID\n            [resIng.contacto.id, m.payload.jid, m.payload.lid || null]);",
   'guardar identidades']
]);

editar('src/core.mjs', 'BUSCA_POR_LID', [
  ["      `SELECT * FROM contactos WHERE empresa_id=$1 AND externos->>$2 = $3 LIMIT 1`,",
   "      `SELECT * FROM contactos WHERE empresa_id=$1\n         AND (externos->>$2 = $3 OR externos->>'wa_jid' = $3 OR externos->>'lid' = $3)   -- BUSCA_POR_LID\n       ORDER BY (tel_norm <> '') DESC, creado LIMIT 1`,",
   'búsqueda del contacto']
]);

console.log(`\n${'─'.repeat(44)}`);
if (errores) { console.error(`  ✖ ${errores} error(es). No se modificó ningún archivo.\n  Pegá esta salida para revisarla.\n`); process.exit(1); }
for (const [rel, s] of cambios) {
  const p = join(R, rel);
  if (!existsSync(p + '.orig6')) copyFileSync(p, p + '.orig6');
  writeFileSync(p, s, 'utf8');
}
console.log(`  ${cambios.length} archivo(s) modificados · ${ya} ya estaban`);
console.log(`${'─'.repeat(44)}\n\n✔ Listo. Ahora:  pm2 restart iciia-crm\n`);
