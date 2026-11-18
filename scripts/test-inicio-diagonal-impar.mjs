/** IMPAR · Inicio de sesión «corte diagonal de dos papeles»: estructura, modo oscuro,
 * movimiento solo con transformaciones y sin restos de los inicios anteriores. */
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const leer = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const html = leer('public/index.html');
const css = leer('public/impar-diseno.css');
const js = leer('public/js/inicio-diagonal.js');
const app = leer('public/js/app.js');

// El acceso sigue con los mismos ids (también los usa el acceso de emergencia).
for (const id of ['login', 'form-login', 'l-usr', 'l-pwd', 'l-btn', 'l-err']) assert.ok(html.includes(`id="${id}"`), id);
for (const c of ['id="ni"', 'ni-papel', 'ni-verde', 'ni-canto', 'ni-marca', 'ni-lado', 'ni-form', 'ni-pie', 'logo-tinta'])
  assert.ok(html.includes(c), c);
for (const s of ['Matriz', 'Barrio Obrero', 'Lambaré', 'Madame Lynch', 'Encarnación', 'Ciudad del Este', 'Pedro Juan Caballero'])
  assert.ok(html.includes(`<li>${s}</li>`), s);
// Sin restos de los inicios anteriores.
assert.ok(!existsSync(new URL('../public/js/inicio-capas.js', import.meta.url)), 'Se quitó el fondo de capas');
assert.ok(!/pc-escena|pc-mensaje|pc-suc|login-card/.test(html), 'Sin marcado del inicio anterior');
assert.ok(!css.includes('Inicio de sesión · capas de papel'), 'Sin estilos del inicio anterior');
assert.ok(!app.includes('inicio-capas') && !app.includes("$('.login-card')"), 'app.js sin referencias viejas');
assert.ok(app.includes("import { iniciarInicioDiagonal } from './inicio-diagonal.js';") && app.includes('iniciarInicioDiagonal();'));
assert.ok(app.includes("const c = $('#form-login'); c.classList.remove('shake');"), 'El aviso de error sacude el formulario');
// Fluidez: sin bucle en JavaScript y animaciones solo de transformación.
assert.ok(!/requestAnimationFrame|setInterval/.test(js), 'Sin bucles de animación en JavaScript');
const claves = [...css.matchAll(/@keyframes ni-[\w-]+\{([^@]*?)\}\s*(?=@|\.|#|\/\*|$)/g)].map(m => m[1]);
assert.ok(claves.length >= 5, 'Animaciones del inicio presentes');
for (const k of claves) assert.ok(!/(left|top|width|height|clip-path|background|filter|box-shadow)\s*:/.test(k), 'Solo transform/opacity: ' + k.slice(0, 60));
// Modo oscuro y movimiento reducido.
assert.ok(css.includes('[data-tema="oscuro"] #login{--ni-fondo:'), 'Variables del modo oscuro');
assert.ok(/prefers-reduced-motion:reduce\)\{\s*\.ni-sombra,\.ni-verde,\.ni-canto,\.ni-relieve,\.ni-brillo\{animation:none!important\}/.test(css));
// Celular y pantallas medianas ordenadas.
assert.ok(css.includes('@media (max-width:900px){') && css.includes('@media (max-width:1400px) and (min-width:901px){'));
// Teclado del celular: modo compacto solo si el área visible se achica, y el campo activo a la vista.
assert.ok(js.includes('ni-escribiendo') && js.includes('alto < base * 0.8') && js.includes("scrollIntoView({ block: 'center' })"));
assert.ok(css.includes('#ni.ni-escribiendo .ni-frase'));
// Guarda contra el bucle del observador (solo escribe la clase si cambió).
assert.ok(js.includes('if (ahora === visible) return;'));
console.log('✔ IMPAR: inicio de sesión con corte diagonal, claro y oscuro, fluido y sin restos de diseños anteriores.');
