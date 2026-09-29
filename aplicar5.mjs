#!/usr/bin/env node
/**
 * Parche 5 · iciia2.0 — cierre definitivo
 *  - Una negociación ganada o cerrada no vuelve a ninguna etapa activa
 *  - Si el cliente vuelve a escribir, se abre una negociación NUEVA en
 *    «Cliente espera respuesta»; cada una conserva su propia conversación
 *  - La ficha del contacto muestra cada vez que se comunicó y cómo terminó
 * Requiere el parche 2. Uso:  node aplicar5.mjs && pm2 restart iciia-crm
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
  for (const paso of pasos) {
    if (typeof paso === 'function') { const r = paso(s); if (r === null) { errores++; return; } s = r; continue; }
    const [viejo, nuevo, etiqueta] = paso;
    if (!s.includes(viejo)) { console.error(`  ✖ ${rel}: no se encontró «${etiqueta}»`); errores++; return; }
    s = s.split(viejo).join(nuevo);
  }
  cambios.push([rel, s]);
  console.log(`  ✔ ${rel}`);
}

console.log('\n══ Parche 5 · cierre definitivo ══\n');
if (!existsSync(join(R, 'src/migrations/004_cierre_definitivo.sql'))) {
  console.error('✖ Falta copiar src/migrations/004_cierre_definitivo.sql\n'); process.exit(1);
}
if (!(leer('src/server.mjs') || '').includes('ERRORES_409')) {
  console.error('✖ Primero hay que aplicar el parche 2.\n'); process.exit(1);
}

/* 1. Servidor: no se mueve una negociación cerrada */
editar('src/routes/negociaciones.mjs', 'CIERRE_DEFINITIVO', [
  ["  if (n.etapa === etapa) return res.json({ ok: true, sinCambios: true });",
   `  if (n.etapa === etapa) return res.json({ ok: true, sinCambios: true });
  /* CIERRE_DEFINITIVO — conserva ganadas y cerradas para los reportes */
  if (['ganado', 'cerrado'].includes(n.etapa)) {
    return res.status(409).json({ error: 'cerrada',
      mensaje: 'Una negociación cerrada no se reabre. Si el cliente vuelve a escribir, se genera una nueva.' });
  }`, 'movimiento de etapa']
]);

/* 2. Cliente que vuelve: negociación nueva en «Cliente espera respuesta» */
editar('src/core.mjs', 'CLIENTE_QUE_VUELVE', [
  ["  /* --- negociación nueva --- */",
   `  /* --- negociación nueva --- */
  /* CLIENTE_QUE_VUELVE — si ya tuvo negociaciones (todas cerradas), la nueva
     entra directo en «Cliente espera respuesta»: el cliente está esperando. */
  const { rows: previas } = await q('SELECT COUNT(*)::int AS n FROM negociaciones WHERE contacto_id=$1', [contacto.id]);
  const vuelve = previas[0].n > 0;`, 'inicio de negociación nueva'],
  ["VALUES ($1,$2,'Contacto entrante','nuevo',",
   "VALUES ($1,$2,${vuelve ? \"'Cliente vuelve a comunicarse','espera'\" : \"'Contacto entrante','nuevo'\"},",
   'etapa inicial'],
  ["    marcadores.push('frecuente');\n    await q('UPDATE contactos SET frecuente=TRUE WHERE id=$1', [contacto.id]);",
   "    marcadores.push('frecuente');\n    await q('UPDATE contactos SET frecuente=TRUE WHERE id=$1 AND empresa_id=$2', [contacto.id, empresa.id]);",
   'marca de frecuente']
]);

/* 3. Error de la base (reapertura) → mensaje claro */
editar('src/server.mjs', 'ERROR_23514', [
  ["  if (err && err.code === '23505') {",
   `  if (err && err.code === '23514') {   // ERROR_23514
    return res.status(409).json({ error: 'cerrada',
      mensaje: 'Una negociación cerrada no se reabre. Si el cliente vuelve a escribir, se genera una nueva.' });
  }
  if (err && err.code === '23505') {`, 'manejador de errores']
]);

/* 4. Tablero: las cerradas no se arrastran */
editar('public/js/negociaciones.js', 'CIERRE_DEFINITIVO', [
  [`draggable="\${MODO_SEL ? 'false' : 'true'}"`,
   `draggable="\${MODO_SEL || ['ganado', 'cerrado'].includes(n.etapa) ? 'false' : 'true'}"`, 'tarjeta arrastrable'],
  ["  if (!n || n.etapa === destino) return;",
   `  if (!n || n.etapa === destino) return;
  if (['ganado', 'cerrado'].includes(n.etapa)) {   // CIERRE_DEFINITIVO
    return toast('Una negociación cerrada no se reabre. Si el cliente vuelve a escribir, se genera una nueva.', 'warn', 'Negociación cerrada');
  }`, 'mover']
]);

/* 5. Ficha: sin botones para reabrir */
editar('public/js/ficha.js', 'CIERRE_DEFINITIVO', [
  ["${(S.empresa.etapas || []).filter(e => e.id !== n.etapa).map(e =>",
   "${cerrada ? '<small style=\"color:var(--muted);line-height:1.6\">Cerrada definitivamente. Si el cliente vuelve a escribir, se abre una negociación nueva y esta queda en el historial.</small>' : ''}${(cerrada ? [] : (S.empresa.etapas || []).filter(e => e.id !== n.etapa)).map(e => /* CIERRE_DEFINITIVO */",
   'botones de etapa']
]);

/* 6. Ficha del contacto: cada contacto y cómo terminó */
editar('src/routes/contactos.mjs', 'n_mensajes', [
  ["SELECT n.*, u.nombre AS agente_nombre FROM negociaciones n LEFT JOIN usuarios u ON u.id=n.agente_id",
   `SELECT n.*, u.nombre AS agente_nombre, ca.nombre AS canal_nombre,
              (SELECT COUNT(*)::int FROM mensajes m WHERE m.negociacion_id=n.id) AS n_mensajes
         FROM negociaciones n LEFT JOIN usuarios u ON u.id=n.agente_id LEFT JOIN canales ca ON ca.id=n.canal_id`,
   'consulta de la ficha']
]);

const LINEA_TIEMPO = `<div class="card-box"><h3>Historial de contactos (\${c.negociaciones.length})</h3>
     <p class="sub" style="margin-top:-6px">Cada vez que el cliente se comunicó y cómo terminó. Tocá una para ver esa conversación.</p>
     \${c.negociaciones.map((n, i) => {
       const num = c.negociaciones.length - i;
       const fin = ['ganado', 'cerrado'].includes(n.etapa);
       const res = n.etapa === 'ganado' ? \`<b style="color:var(--ok)">✅ Venta cerrada · \${gs(n.monto_cierre)}</b>\`
         : n.etapa === 'cerrado' ? \`<b style="color:var(--bad)">✖ Cerrada sin venta</b>\${n.motivo ? ' · ' + esc(n.motivo) : ''}\`
         : \`<b style="color:var(--warn)">● En curso · \${esc(etapa(n.etapa).nombre)}</b>\`;
       const dias = fin ? Math.max(0, Math.round((new Date(n.entrada_etapa) - new Date(n.creado)) / 86400000)) : null;
       return \`<div data-neg="\${n.id}" style="cursor:pointer;display:flex;gap:12px;align-items:flex-start;padding:12px 0;border-bottom:1px solid var(--line)">
         <div style="flex:none;width:34px;height:34px;border-radius:50%;display:grid;place-items:center;font-weight:700;font-size:var(--fs-sm);background:var(--surface2);border:2px solid \${etapa(n.etapa).color}">\${num}</div>
         <div style="flex:1;min-width:0">
           <div style="font-size:var(--fs-sm)">\${res}</div>
           <small style="color:var(--muted);display:block;margin-top:3px;line-height:1.6">
             \${fdate(n.creado)}\${fin ? ' → ' + fdate(n.entrada_etapa) + ' (' + (dias === 0 ? 'mismo día' : dias + ' día(s)') + ')' : ''}
             · \${esc(n.origen)}\${n.canal_nombre ? ' · ' + esc(n.canal_nombre) : ''} · \${esc(n.agente_nombre || 'sin asignar')}
             · 💬 \${n.n_mensajes || 0} mensaje(s)\${(n.marcadores || []).includes('regestionado') ? ' · iniciado por el agente' : ''}</small></div>
         <span style="flex:none;color:var(--muted);align-self:center;font-size:18px">›</span></div>\`;
     }).join('') || vacio('◫', 'Sin contactos registrados', '')}</div></div>`;

editar('public/js/contactos.js', 'Historial de contactos', [s => {
  const ini = s.indexOf('<div class="card-box"><h3>Histórico de negociaciones</h3>');
  const finTxt = "Sin negociaciones</td></tr>'}</tbody></table></div></div>";
  const fin = ini < 0 ? -1 : s.indexOf(finTxt, ini);
  if (ini < 0 || fin < 0) { console.error('  ✖ public/js/contactos.js: no se encontró «Histórico de negociaciones»'); return null; }
  return s.slice(0, ini) + LINEA_TIEMPO + s.slice(fin + finTxt.length);
}]);

console.log(`\n${'─'.repeat(46)}`);
if (errores) { console.error(`  ✖ ${errores} error(es). No se modificó ningún archivo.\n  Pegá esta salida para revisarla.\n`); process.exit(1); }
for (const [rel, s] of cambios) {
  const p = join(R, rel);
  if (!existsSync(p + '.orig5')) copyFileSync(p, p + '.orig5');
  writeFileSync(p, s, 'utf8');
}
console.log(`  ${cambios.length} archivo(s) modificados · ${ya} ya estaban`);
console.log(`${'─'.repeat(46)}\n\n✔ Listo. Ahora:  pm2 restart iciia-crm\n`);
