/** IMPAR · Pantalla de acceso clásica y centrada, con las variables del CRM,
 * sin restos de inicios anteriores y con las formas del fondo completas. */
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const leer = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const html = leer('public/index.html');
const css = leer('public/impar-diseno.css');
const js = leer('public/js/inicio-acceso.js');
const app = leer('public/js/app.js');

for (const id of ['login', 'form-login', 'l-usr', 'l-pwd', 'l-btn', 'l-err', 'l-tema', 'l-anio']) assert.ok(html.includes(`id="${id}"`), id);
for (const c of ['class="lc"', 'lc-logo', 'lc-tarjeta', 'lc-pie', 'logo-tinta']) assert.ok(html.includes(c), c);
assert.ok(!/id="(ri|ni|la)"|class="(ni|ri|la)-|pc-escena|login-card/.test(html), 'Sin marcado anterior');
for (const f of ['inicio-capas.js', 'inicio-diagonal.js', 'inicio-ilustrado.js', 'inicio-crm.js']) assert.ok(!existsSync(new URL('../public/js/' + f, import.meta.url)), f);
assert.ok(!/Inicio de sesión · (capas|corte diagonal|escritorio ilustrado|con la misma estructura)/.test(css) && !css.includes('.login-card'));
assert.ok(app.includes("import { iniciarInicioAcceso } from './inicio-acceso.js';") && app.includes('iniciarInicioAcceso();'));
assert.ok(app.includes("const c = $('#form-login'); c.classList.remove('shake');"));
const bloque = css.slice(css.indexOf('Inicio de sesión · pantalla de acceso clásica'));
for (const v of ['var(--surface)', 'var(--line)', 'var(--txt)', 'var(--muted)', 'var(--sombra)', 'var(--f-titulo)']) assert.ok(bloque.includes(v), v);
// Formas del fondo apoyadas en las esquinas, sin quedar cortadas por bordes de pantalla.
assert.ok(css.includes('body::before{left:240px;bottom:0;background:var(--cuarto-verde);border-radius:0 100% 0 0}'));
assert.ok(css.includes('body::after{right:0;top:0;background:var(--cuarto-gris);border-radius:0 0 0 100%}'));
// Teclado del celular: centrado con margin:auto (desplazable) y modo compacto con el botón a la vista.
assert.ok(bloque.includes('#login .lc{margin:auto}') && !bloque.includes('place-items:center'));
assert.ok(js.includes('lc-teclado') && js.includes("scrollIntoView({ block: 'end' })") && bloque.includes('#login.lc-teclado .lc-logo'));
assert.ok(js.includes("localStorage.setItem('iciia_tema', S.tema)") && js.includes('aplicarTema()'));
console.log('✔ IMPAR: acceso clásico centrado, con los tonos del CRM y el fondo completo.');
