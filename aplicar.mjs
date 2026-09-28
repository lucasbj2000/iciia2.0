#!/usr/bin/env node
/**
 * Parche iciia2.0 — corrige el loop de notificaciones de WhatsApp,
 * el menú bloqueado en móvil, y agrega el módulo de importación/exportación.
 *
 * Uso:  node aplicar.mjs        (desde /opt/iciia-crm)
 */
import { readFileSync, writeFileSync, existsSync, copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const RAIZ = process.cwd();
let hechos = 0, saltados = 0;
const ok = m => { console.log('  ✔ ' + m); hechos++; };
const skip = m => { console.log('  · ' + m); saltados++; };
const fallo = m => { console.error('  ✖ ' + m); process.exitCode = 1; };

function leer(rel) {
  const p = join(RAIZ, rel);
  if (!existsSync(p)) { fallo(`No existe ${rel}`); return null; }
  return readFileSync(p, 'utf8');
}
function escribir(rel, txt) {
  const p = join(RAIZ, rel);
  if (!existsSync(p + '.orig')) copyFileSync(p, p + '.orig');
  writeFileSync(p, txt, 'utf8');
}

console.log('\n══ Parche iciia2.0 ══\n');

/* ═══ 1. LOOP DE NOTIFICACIONES DE WHATSAPP ═══ */
console.log('1. Loop de notificaciones de WhatsApp');
{
  const rel = 'src/channels/baileys.mjs';
  let s = leer(rel);
  if (s) {
    if (s.includes('ANTILOOP')) skip('ya estaba aplicado');
    else {
      // Solo avisa si el estado cambió de verdad, y con enfriamiento
      s = s.replace(
        'async function avisar(canal, estado) {',
        `const ultimoAviso = new Map();   // ANTILOOP
async function avisar(canal, estado) {
  const clave = canal.id + ':' + estado;
  const previo = ultimoAviso.get(canal.id);
  // No repetir el mismo estado, ni avisar más de una vez cada 10 minutos
  if (previo && previo.estado === estado && Date.now() - previo.ts < 600000) return;
  ultimoAviso.set(canal.id, { estado, ts: Date.now() });`);

      if (!s.includes('ANTILOOP')) { fallo('no se encontró avisar()'); }
      else {
        // El aviso de desconexión solo si estuvo conectado antes
        s = s.replace(
          `      if (connection === 'close') {
        const code = lastDisconnect?.error?.output?.statusCode;
        S.estado = 'desconectado'; S.arrancando = false;`,
          `      if (connection === 'close') {
        const code = lastDisconnect?.error?.output?.statusCode;
        const estabaConectado = S.estado === 'conectado';   // ANTILOOP
        S.estado = 'desconectado'; S.arrancando = false;`);

        s = s.replace(
          `          emitir(canal.empresa_id, 'canal:estado', { canalId: id, estado: 'desconectado' });
          if (code !== mod.DisconnectReason?.loggedOut) {`,
          `          if (estabaConectado) emitir(canal.empresa_id, 'canal:estado', { canalId: id, estado: 'desconectado' });
          if (code !== mod.DisconnectReason?.loggedOut) {
            if (estabaConectado) await avisar(canal, 'desconectada');`);

        // Quitar el aviso que estaba dentro del bucle de reconexión
        s = s.replace(
          `            rmSync(carpeta, { recursive: true, force: true });
            S.qr = null;
            await avisar(canal, 'desvinculada');`,
          `            rmSync(carpeta, { recursive: true, force: true });
            S.qr = null;
            ultimoAviso.delete(id);
            await avisar(canal, 'desvinculada');`);

        escribir(rel, s);
        ok('avisos con enfriamiento de 10 minutos y sin repetir estado');
      }
    }
  }
}

/* ═══ 2. TOPE DE NOTIFICACIONES REPETIDAS EN EL SERVIDOR ═══ */
console.log('\n2. Tope de notificaciones repetidas');
{
  const rel = 'src/core.mjs';
  let s = leer(rel);
  if (s) {
    if (s.includes('SIN_REPETIR')) skip('ya estaba aplicado');
    else {
      s = s.replace(
        'export async function notificar(empresa, tipo, vars = {}, base = [], ref = null) {',
        `const recientes = new Map();   // SIN_REPETIR
export async function notificar(empresa, tipo, vars = {}, base = [], ref = null) {
  // Evita avisos idénticos en ráfaga (mismo tipo y mismo texto en 5 minutos)
  const huella = \`\${empresa?.id}|\${tipo}|\${JSON.stringify(vars)}\`;
  const visto = recientes.get(huella);
  if (visto && Date.now() - visto < 300000) return;
  recientes.set(huella, Date.now());
  if (recientes.size > 500) {
    const limite = Date.now() - 300000;
    for (const [k, v] of recientes) if (v < limite) recientes.delete(k);
  }`);
      if (!s.includes('SIN_REPETIR')) fallo('no se encontró notificar()');
      else { escribir(rel, s); ok('no se repite el mismo aviso dentro de 5 minutos'); }
    }
  }
}

/* ═══ 3. MENÚ BLOQUEADO EN MÓVIL ═══ */
console.log('\n3. Menú bloqueado en móvil');
{
  const rel = 'public/styles.css';
  let s = leer(rel);
  if (s) {
    if (s.includes('FIX_MENU_MOVIL')) skip('ya estaba aplicado');
    else {
      s += `

/* ===== FIX_MENU_MOVIL =====
   El overlay quedaba por encima del menú y bloqueaba los toques. */
@media(max-width:900px){
  body.nav-open:after{ z-index:88 !important; }
  aside{ z-index:95 !important; }
  aside nav, aside .brand, aside .me{ position:relative; z-index:2; }
  aside nav .nav-i{ pointer-events:auto !important; }
  header.top{ z-index:20; }
  body.nav-open header.top{ z-index:10; }
  body.nav-open{ overflow:hidden; }
}
`;
      escribir(rel, s);
      ok('overlay por debajo del menú y toques habilitados');
    }
  }
}

/* ═══ 4. CERRAR EL MENÚ AL TOCAR FUERA ═══ */
console.log('\n4. Cerrar el menú al tocar fuera');
{
  const rel = 'public/js/app.js';
  let s = leer(rel);
  if (s) {
    if (s.includes('CERRAR_MENU')) skip('ya estaba aplicado');
    else {
      s = s.replace(
        `$('#btn-burger').onclick = () => { document.body.classList.toggle('nav-open'); vibrar(10); };`,
        `$('#btn-burger').onclick = e => {
  e.stopPropagation();
  document.body.classList.toggle('nav-open');
  vibrar(10);
};
/* CERRAR_MENU — tocar fuera del panel lo cierra */
document.addEventListener('click', e => {
  if (!document.body.classList.contains('nav-open')) return;
  if (e.target.closest('aside') || e.target.closest('#btn-burger')) return;
  document.body.classList.remove('nav-open');
});`);
      if (!s.includes('CERRAR_MENU')) fallo('no se encontró el botón del menú');
      else { escribir(rel, s); ok('el menú se cierra al tocar fuera'); }
    }
  }
}

/* ═══ 5. MÓDULO DE DATOS ═══ */
console.log('\n5. Módulo de importación y exportación');
{
  const faltan = [];
  if (!existsSync(join(RAIZ, 'src/routes/datos.mjs'))) faltan.push('src/routes/datos.mjs');
  if (!existsSync(join(RAIZ, 'public/js/datos.js'))) faltan.push('public/js/datos.js');
  if (faltan.length) fallo(`Copiá primero estos archivos: ${faltan.join(', ')}`);
  else {
    // Registrar la ruta en el servidor
    const rel = 'src/server.mjs';
    let s = leer(rel);
    if (s) {
      if (s.includes("routes/datos.mjs")) skip('la ruta ya estaba registrada');
      else {
        s = s.replace(
          "import rVarios from './routes/varios.mjs';",
          "import rVarios from './routes/varios.mjs';\nimport rDatos from './routes/datos.mjs';");
        s = s.replace(
          "app.use('/api', rVarios);",
          "app.use('/api/datos', rDatos);\napp.use('/api', rVarios);");
        escribir(rel, s);
        ok('ruta /api/datos registrada');
      }
    }
    // Agregar la pestaña en administración
    const relA = 'public/js/admin.js';
    let a = leer(relA);
    if (a) {
      if (a.includes("'datos'")) skip('la pestaña ya existía');
      else {
        a = a.replace(
          "['limpieza', 'Limpieza'], ['audit', 'Auditoría']",
          "['datos', '🔄 Importar / Exportar'], ['limpieza', 'Limpieza'], ['audit', 'Auditoría']");
        a = a.replace(
          "    limpieza: aLimpieza, audit: aAudit }[TADM];",
          "    limpieza: aLimpieza, audit: aAudit, datos: aDatos }[TADM];");
        a = a.replace(
          "const AB = () => $('#adm-body');",
          `const AB = () => $('#adm-body');
async function aDatos() { const m = await import('./datos.js'); await m.vistaDatos(); }`);
        escribir(relA, a);
        ok('pestaña «Importar / Exportar» agregada');
      }
    }
  }
}

console.log(`\n${'─'.repeat(40)}`);
console.log(`  ${hechos} cambio(s) · ${saltados} ya estaban`);
console.log(`${'─'.repeat(40)}`);
console.log('\nAhora:  pm2 restart iciia-crm\n');
console.log('Los archivos originales quedaron como *.orig por si hay que volver atrás.\n');
