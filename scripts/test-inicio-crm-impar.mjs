/** IMPAR · Inicio de sesión con la misma estructura y tonos del CRM (menú lateral,
 * encabezado y columnas de Negociaciones), sin restos de inicios anteriores. */
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const leer = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const html = leer('public/index.html');
const css = leer('public/impar-diseno.css');
const js = leer('public/js/inicio-crm.js');
const app = leer('public/js/app.js');

for (const id of ['login', 'form-login', 'l-usr', 'l-pwd', 'l-btn', 'l-err', 'l-tema', 'l-saludo']) assert.ok(html.includes(`id="${id}"`), id);
for (const c of ['id="la"', 'la-lado', 'la-top', 'la-tablero', 'la-col-acceso', 'la-col-info', 'la-tarjeta', 'logo-tinta']) assert.ok(html.includes(c), c);
for (const s of ['Matriz', 'Barrio Obrero', 'Lambaré', 'Madame Lynch', 'Encarnación', 'Ciudad del Este', 'Pedro Juan Caballero']) assert.ok(html.includes(s), s);
// Sin restos de inicios anteriores.
assert.ok(!/id="ri"|id="ni"|class="ni-|class="ri-|pc-escena|login-card/.test(html), 'Sin marcado anterior');
for (const f of ['inicio-capas.js', 'inicio-diagonal.js', 'inicio-ilustrado.js']) assert.ok(!existsSync(new URL('../public/js/' + f, import.meta.url)), f);
assert.ok(!/Inicio de sesión · (capas|corte diagonal|escritorio ilustrado)/.test(css) && !css.includes('.login-card'), 'Sin estilos anteriores');
assert.ok(app.includes("import { iniciarInicioCRM } from './inicio-crm.js';") && app.includes('iniciarInicioCRM();'));
assert.ok(app.includes("const c = $('#form-login'); c.classList.remove('shake');"));
// Mismos tonos: solo variables del CRM para superficies, líneas y textos.
const bloque = css.slice(css.indexOf('Inicio de sesión · con la misma estructura'));
for (const v of ['var(--surface)', 'var(--surface2)', 'var(--line)', 'var(--txt)', 'var(--muted)', 'var(--verde-texto)', 'var(--f-titulo)']) assert.ok(bloque.includes(v), v);
assert.ok(!/\[data-tema="oscuro"\] \.la-(?!tema)/.test(bloque), 'El modo oscuro sale de las variables del CRM');
assert.ok(bloque.includes('body:has(#login:not(.hidden)){background-image:var(--fondo-grano)'), 'Mismo fondo que Negociaciones');
// Tema: el botón del acceso usa el mismo tema que el CRM.
assert.ok(js.includes("localStorage.setItem('iciia_tema', S.tema)") && js.includes('aplicarTema()'));
assert.ok(css.includes('@media (max-width:860px){') && bloque.includes('.la-lado{display:none}'), 'Versión celular');
console.log('✔ IMPAR: inicio de sesión con la misma estructura y tonos del CRM, claro y oscuro.');
