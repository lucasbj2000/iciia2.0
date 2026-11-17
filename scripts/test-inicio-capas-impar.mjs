/** IMPAR · Inicio de sesión con capas de papel: estructura, modo oscuro y que el
 * fondo animado solo corra en la pantalla de acceso (sin bucles del observador). */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const leer = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const html = leer('public/index.html');
const js = leer('public/js/inicio-capas.js');
const app = leer('public/js/app.js');
const css = leer('public/impar-diseno.css');

// Acceso intacto: los mismos ids que usa el login y el acceso de emergencia.
for (const id of ['login', 'form-login', 'l-usr', 'l-pwd', 'l-btn', 'l-err']) assert.ok(html.includes(`id="${id}"`), id);
// Composición: logo completo, mensaje, sucursales y saludo.
for (const c of ['pc-logo', 'pc-mensaje', 'pc-suc', 'pc-saludo', 'logo-tinta']) assert.ok(html.includes(c), c);
for (const s of ['Matriz', 'Barrio Obrero', 'Lambaré', 'Madame Lynch', 'Encarnación', 'Ciudad del Este', 'Pedro Juan Caballero'])
  assert.ok(html.includes(`<span>${s}</span>`), s);
// Se inicia desde app.js.
assert.ok(app.includes("import { iniciarInicioCapas } from './inicio-capas.js';") && app.includes('iniciarInicioCapas();'));
// Dos paletas y repintado al cambiar de tema.
assert.ok(js.includes('claro:') && js.includes('oscuro:') && js.includes("attributeFilter: ['class', 'data-tema']"));
assert.ok(css.includes('[data-tema="oscuro"] #login{'), 'Variables del modo oscuro');
// Solo en el acceso: se apaga al entrar y respeta el movimiento reducido.
assert.ok(js.includes("login.classList.contains('hidden')") && js.includes('sesion-verificando'));
assert.ok(js.includes('function apagar()') && js.includes('cancelAnimationFrame(cuadro)') && js.includes('escena.remove()'));
assert.ok(js.includes("prefers-reduced-motion: reduce"));
// Guarda contra el bucle: classList.remove escribe el atributo aunque no cambie.
assert.ok(/if \(document\.documentElement\.classList\.contains\('en-acceso'\)\) document\.documentElement\.classList\.remove\('en-acceso'\)/.test(js));
assert.ok(js.includes('if (!corriendo && !escena) return;'));
// Sin estilos en línea escritos como texto (la política de seguridad los bloquearía en SVG).
assert.ok(!/style="/.test(js), 'Estilos aplicados con element.style');
console.log('✔ IMPAR: inicio de sesión con capas de papel en claro y oscuro, solo en la pantalla de acceso.');
