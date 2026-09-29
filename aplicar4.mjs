#!/usr/bin/env node
/**
 * Parche 4 · iciia2.0
 *  - Token de OpenAI (cifrado) y bot que responde de verdad
 *  - Instrucciones del bot por línea (cada número o red social)
 *  - Carga manual simplificada: nombre, teléfono y mensajes; reutiliza el
 *    contacto existente y agrega los mensajes al final de su conversación
 * Requiere el parche 2. Uso:  node aplicar4.mjs && pm2 restart iciia-crm
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
  for (const [viejo, nuevo, etiqueta, opcional] of pasos) {
    if (!s.includes(viejo)) {
      if (opcional) { console.log(`    (se omite «${etiqueta}»: no aplica en esta versión)`); continue; }
      console.error(`  ✖ ${rel}: no se encontró «${etiqueta}»`); errores++; return;
    }
    s = s.split(viejo).join(nuevo);
  }
  cambios.push([rel, s]);
  console.log(`  ✔ ${rel}`);
}

console.log('\n══ Parche 4 · IA, bot por línea y carga manual ══\n');
const faltan = ['src/migrations/003_ia_bot.sql', 'src/bot.mjs', 'src/routes/ia.mjs', 'src/routes/manual.mjs',
  'public/js/ia.js', 'public/js/manual.js'].filter(f => !existsSync(join(R, f)));
if (faltan.length) { console.error(`✖ Faltan archivos del parche:\n   ${faltan.join('\n   ')}\n`); process.exit(1); }
if (!(leer('src/db.mjs') || '').includes('TELNORM_PY')) { console.error('✖ Primero hay que aplicar el parche 2.\n'); process.exit(1); }

editar('src/server.mjs', 'rutas-v4', [
  ["import rVarios from './routes/varios.mjs';",
   "import rVarios from './routes/varios.mjs';\nimport rIA from './routes/ia.mjs';          // rutas-v4\nimport rManual from './routes/manual.mjs';",
   'imports de rutas'],
  ["app.use('/api', rVarios);",
   "app.use('/api/ia', rIA);\napp.use('/api/manual', rManual);\napp.use('/api', rVarios);", 'registro de rutas']
]);

editar('src/core.mjs', 'programarBot', [
  ["import { q, telNorm } from './db.mjs';", "import { q, telNorm } from './db.mjs';\nimport { programarBot } from './bot.mjs';", 'import'],
  [`  if (empresa.flags?.bot && empresa.bot?.activo) {
    await q(\`INSERT INTO mensajes (empresa_id,negociacion_id,dir,txt,bot,ts) VALUES ($1,$2,'out',$3,TRUE,now())\`,
      [empresa.id, neg.id, String(empresa.bot.instrucciones || '').slice(0, 300)]);
  }`,
   `  // El bot responde con OpenAI (antes solo guardaba el texto de las instrucciones)
  if (empresa.flags?.bot && empresa.bot?.activo) programarBot(empresa, neg.id);`, 'respuesta del bot en contacto nuevo'],
  ["    return { negociacionId: abierta.id, reusada: true, contacto };",
   "    if (abierta.bot_activo && empresa.flags?.bot && empresa.bot?.activo) programarBot(empresa, abierta.id);\n    return { negociacionId: abierta.id, reusada: true, contacto };",
   'respuesta del bot en conversación abierta']
]);

editar('public/js/admin.js', 'aIA', [
  ["['edicion', '✏ Editar datos'],", "['edicion', '✏ Editar datos'], ['ia', '🤖 IA y bot'],", 'pestaña'],
  ["edicion: aEdicion }[TADM]", "edicion: aEdicion, ia: aIA }[TADM]", 'mapa de pestañas'],
  ["const AB = () => $('#adm-body');",
   "const AB = () => $('#adm-body');\nasync function aIA() { const m = await import('./ia.js'); await m.vistaIA(); }", 'función'],
  ["['bot', 'Bot'], ", '', 'pestaña Bot anterior', true],
  ["    modalCargaManual({ ...d2, origen: 'whatsapp', motivo: 'Mensaje perdido por el bot' });",
   "    import('./manual.js').then(m => m.modalCargaManual({ nombre: d2.nombre, tel: d2.tel, mensaje: d2.mensaje }));",
   'carga desde cuarentena', true]
]);

editar('public/js/negociaciones.js', 'manual.js', [
  ["  if ($('#b-manual')) $('#b-manual').onclick = () => modalCargaManual();",
   "  if ($('#b-manual')) $('#b-manual').onclick = () => import('./manual.js').then(m => m.modalCargaManual());",
   'botón de carga manual']
]);

console.log(`\n${'─'.repeat(46)}`);
if (errores) { console.error(`  ✖ ${errores} error(es). No se modificó ningún archivo.\n  Pegá esta salida para revisarla.\n`); process.exit(1); }
for (const [rel, s] of cambios) {
  const p = join(R, rel);
  if (!existsSync(p + '.orig4')) copyFileSync(p, p + '.orig4');
  writeFileSync(p, s, 'utf8');
}
console.log(`  ${cambios.length} archivo(s) modificados · ${ya} ya estaban`);
console.log(`${'─'.repeat(46)}\n\n✔ Listo. Ahora:  pm2 restart iciia-crm`);
console.log('  Después: Administración → 🤖 IA y bot → cargá el token de OpenAI.\n');
