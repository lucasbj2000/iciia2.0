#!/usr/bin/env node
/** Pestañas abiertas antes de una actualización: cargan la versión nueva solas, sin perder lo escrito. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const js = readFileSync('public/js/version.js', 'utf8');
assert.match(js, /fetch\('\/api\/health'/, 'compara con la versión que informa el servidor');
assert.match(js, /function momentoSeguro\(\)/);
assert.match(js, /#modals > \*, #ll-card, #vt:not\(\[hidden\]\), #ll-panel, \.conversation-modal/, 'no recarga con una ventana, ficha o llamada abierta');
assert.match(js, /textarea/, 'no recarga si hay texto sin enviar');
assert.match(js, /INACTIVIDAD_MS = 2 \* 60e3/, 'espera 2 minutos sin uso');
assert.match(js, /Actualizar ahora/, 'mientras tanto ofrece actualizar a mano');
assert.match(js, /if \(iniciado\) return;/, 'una sola vez por pestaña');
const app = readFileSync('public/js/app.js', 'utf8');
assert.match(app, /import \{ iniciarVersion, verificarVersion \} from '\.\/version\.js';/);
assert.match(app, /if \(sseYaConectado\) verificarVersion\(\);/, 'tras reconectar con el servidor revisa la versión');
assert.match(readFileSync('src/server.mjs', 'utf8'), /build: BUILD_SHA \}\);/, 'el servidor informa su versión');
console.log('✓ el CRM abierto se actualiza solo en un momento seguro');
