#!/usr/bin/env node
/** Llamadas de WhatsApp en prueba: la interfaz solo se carga para el administrador probador. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const js = readFileSync('public/js/llamadas-wa.js', 'utf8');
assert.match(js, /if \(!esAdmin\(\)\) return;/, 'los no administradores no consultan las llamadas');
assert.match(js, /if \(!estado\?\.visible\) return;/, 'sin visibilidad no se dibuja nada');
assert.match(js, /const habilitado = \(\) => !!\(estado\?\.visible && estado\.activo && estado\.probador\)/, 'solo el probador con llamadas activas');
assert.match(js, /function botonFicha[\s\S]*?if \(!habilitado\(\)/, 'el botón de la ficha exige probador');
assert.match(js, /async function recibirEvento[\s\S]*?if \(!habilitado\(\)\) return;/, 'las llamadas entrantes exigen probador');
const app = readFileSync('public/js/app.js', 'utf8');
assert.match(app, /import\('\.\/llamadas-wa\.js'\)\.then\(m => m\.iniciarLlamadas\(\)\)/);
assert.match(app, /es\.addEventListener\('llamada'/);
assert.match(readFileSync('public/js/ficha.js', 'utf8'), /impar:ficha-lista/);
assert.match(readFileSync('public/index.html', 'utf8'), /href="\/llamadas\.css\?v=/);
const ruta = readFileSync('src/routes/llamadas.mjs', 'utf8');
assert.match(ruta, /r\.use\(requiere\('admin'\)\)/, 'rutas solo para administradores');
const mod = readFileSync('src/llamadas-wa-impar.mjs', 'utf8');
assert.match(mod, /call_icon_visibility: 'DISABLE_ALL'/, 'al activar, el ícono queda oculto a los clientes');
assert.match(readFileSync('src/server.mjs', 'utf8'), /app\.use\('\/api\/llamadas', rLlamadas\)/);
console.log('✓ llamadas de WhatsApp limitadas al administrador probador');
