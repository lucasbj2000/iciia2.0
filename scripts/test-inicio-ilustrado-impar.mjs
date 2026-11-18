/** IMPAR · Inicio de sesión ilustrado: estructura, modo oscuro, movimiento solo con
 * transformaciones, teclado del celular y sin restos de inicios anteriores. */
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const leer = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const html = leer('public/index.html');
const css = leer('public/impar-diseno.css');
const js = leer('public/js/inicio-ilustrado.js');
const app = leer('public/js/app.js');

for (const id of ['login', 'form-login', 'l-usr', 'l-pwd', 'l-btn', 'l-err']) assert.ok(html.includes(`id="${id}"`), id);
for (const c of ['id="ri"', 'ri-marco', 'ri-fondo', 'ri-izq', 'ri-der', 'class="ri-ilus"', 'ri-celular', 'ri-resmas', 'ri-lapicero', 'ri-cartulinas', 'logo-tinta'])
  assert.ok(html.includes(c), c);
assert.ok(!/class="ni-|id="ni"|pc-escena|login-card/.test(html), 'Sin marcado de inicios anteriores');
for (const f of ['inicio-capas.js', 'inicio-diagonal.js']) assert.ok(!existsSync(new URL('../public/js/' + f, import.meta.url)), f);
assert.ok(!css.includes('Inicio de sesión · corte diagonal') && !css.includes('Inicio de sesión · capas de papel'), 'Sin estilos anteriores');
assert.ok(app.includes("import { iniciarInicioIlustrado } from './inicio-ilustrado.js';") && app.includes('iniciarInicioIlustrado();'));
assert.ok(app.includes("const c = $('#form-login'); c.classList.remove('shake');"));
// Ids del SVG sin chocar con el resto de la página.
for (const id of [...html.matchAll(/<svg[\s\S]*?<\/svg>/g)].flatMap(m => [...m[0].matchAll(/ id="([^"]+)"/g)].map(x => x[1])))
  assert.equal(html.split(`id="${id}"`).length - 1, 1, 'id único: ' + id);
// Fluidez: sin bucles en JS y animaciones solo con transform/opacity.
assert.ok(!/requestAnimationFrame|setInterval/.test(js));
const bloque = css.slice(css.indexOf('Inicio de sesión · escritorio ilustrado'));
const claves = [...bloque.matchAll(/@keyframes ri-[\w-]+\{(.*?\})\}/g)].map(m => m[1]);
assert.ok(claves.length >= 6);
for (const k of claves) assert.ok(!/(left|top|width|height|clip-path|background|filter|box-shadow)\s*:/.test(k), k.slice(0, 60));
// Modo oscuro y movimiento reducido.
assert.ok(css.includes('[data-tema="oscuro"] #login{--ri-fondo:') && css.includes('[data-tema="oscuro"] .ri-ilus :not(text)[fill="#FFFFFF"]'));
assert.ok(css.includes('.ri-ilus *,.ri-mancha{animation:none!important}'));
// Celular con teclado y guarda contra el bucle del observador.
assert.ok(js.includes('ri-escribiendo') && js.includes('alto() < base * 0.8') && js.includes('if (ahora === visible) return;'));
console.log('✔ IMPAR: inicio ilustrado con objetos de IMPAR y el CRM, claro y oscuro, fluido y ordenado.');
