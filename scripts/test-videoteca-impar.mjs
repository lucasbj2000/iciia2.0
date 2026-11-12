#!/usr/bin/env node
/** Sala de novedades: lista de videos válida, archivos presentes y botón conectado al CRM. */
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';

const lista = JSON.parse(readFileSync('public/videos/actualizaciones.json', 'utf8'));
assert.ok(Array.isArray(lista.videos) && lista.videos.length >= 1, 'hay al menos un video');
const ids = new Set();
for (const v of lista.videos) {
  for (const k of ['id', 'titulo', 'fecha', 'archivo', 'poster', 'duracion']) assert.ok(v[k], `${v.id || '?'}: falta ${k}`);
  assert.ok(!ids.has(v.id), 'id repetido: ' + v.id); ids.add(v.id);
  assert.match(v.fecha, /^\d{4}-\d{2}-\d{2}$/, v.id + ': fecha AAAA-MM-DD');
  for (const k of ['archivo', 'poster']) {
    assert.ok(v[k].startsWith('/videos/'), `${v.id}: ${k} dentro de /videos/`);
    const ruta = 'public' + v[k];
    assert.ok(existsSync(ruta), `${v.id}: no existe ${ruta}`);
    assert.ok(statSync(ruta).size < 25 * 1024 * 1024, `${v.id}: ${k} demasiado pesado para el repositorio`);
  }
  let previo = -1;
  for (const c of v.capitulos || []) { assert.ok(c.titulo && Number(c.t) > previo, `${v.id}: capítulos ordenados`); previo = Number(c.t); }
  console.log('✓ video ' + v.id);
}

const html = readFileSync('public/index.html', 'utf8');
assert.match(html, /href="\/videoteca\.css\?v=/, 'index enlaza videoteca.css');
const app = readFileSync('public/js/app.js', 'utf8');
assert.match(app, /import\('\.\/videoteca\.js'\)\.then\(m => m\.iniciarVideoteca\(\)\)/, 'app inicia la videoteca después del ingreso');
const js = readFileSync('public/js/videoteca.js', 'utf8');
assert.match(js, /export async function iniciarVideoteca/);
assert.match(js, /\/videos\/actualizaciones\.json/);
assert.match(js, /e\.key === 'Escape'/, 'Esc cierra la sala');
assert.match(js, /aria-modal/, 'la sala es un diálogo modal');
assert.ok(!/localStorage\.(get|set)Item[^\n]*\n?/.test(js.replace(/try \{[^}]*localStorage\.(get|set)Item[^}]*\}/g, '')), 'localStorage siempre dentro de try');
assert.match(js, /esc\(x\.titulo\)/, 'títulos escapados');
const css = readFileSync('public/videoteca.css', 'utf8');
assert.match(css, /prefers-reduced-motion:reduce/, 'respeta movimiento reducido');
assert.match(css, /@media \(max-width:820px\)/, 'sala adaptada a celular');
assert.match(readFileSync('public/sw.js', 'utf8'), /if\(!BASICOS\.includes\(u\.pathname\)\)return;/, 'el service worker no intercepta los videos');
console.log('✓ botón, sala y estilos conectados');
