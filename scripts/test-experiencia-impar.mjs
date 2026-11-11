// IMPAR: experiencia visual — hojas de papel, urgencia, pilas, Ctrl+K, barra inferior, gestos, foco, Inicio y sala día/noche.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const leer = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const exp = leer('public/js/experiencia.js'), neg = leer('public/js/negociaciones.js'), app = leer('public/js/app.js'), ficha = leer('public/js/ficha.js'), css = leer('public/experiencia.css');
assert.ok(neg.includes('card hoja-papel') && neg.includes('--urg:hsl(') && neg.includes('class="col-pila"'), 'Hojas, urgencia y pilas');
assert.ok(neg.includes('gestosTarjeta(el, id)') && neg.includes("if (destino === 'ganado') sellar("), 'Gestos y sello de venta');
assert.ok(exp.includes("e.key.toLowerCase() === 'k'") && exp.includes("id = 'barra-movil'") && exp.includes('export async function siguienteEnEspera'), 'Ctrl+K, barra inferior y siguiente cliente');
assert.ok(!exp.includes("import('./app.js')"), 'No crea una segunda copia de la app');
assert.ok(!/onclick="/.test(exp), 'Sin código en línea (lo bloquea la política de seguridad)');
assert.ok(app.includes("S.vista = 'inicio'") && app.includes("new Event('impar:cliente-nuevo')") && app.includes("new Event('impar:vista')"), 'Inicio al entrar y eventos');
assert.ok(ficha.includes('id="f-foco"') && ficha.includes('class="ficha-hoja"') && ficha.includes("chipsTeclado('msg')"), 'Modo foco, hoja del cliente y fichas sobre el teclado');
assert.ok(leer('public/js/sala-control.js').includes('raiz.dataset.momento'), 'Sala con la hora del día');
assert.ok(css.includes('prefers-reduced-motion') && css.includes('body.modal-open #barra-movil') && leer('public/index.html').includes('/experiencia.css?v='), 'Estilos cargados y movimiento reducido respetado');
console.log('✔ IMPAR: experiencia visual (papel, urgencia, Ctrl+K, móvil de pulgar, foco, Inicio y sala día/noche).');
