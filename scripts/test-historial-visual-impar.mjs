// IMPAR: el Historial de la negociación se lee como una línea de tiempo, con nombres y sin identificadores.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const leer = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');

const fuente = leer('public/js/historial-visual.js').replace(/^import .*$/gm, '').replace(/^export /gm, '');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const ETAPAS = { espera: { nombre: 'Cliente espera respuesta', color: '#e85d9c' }, contactado: { nombre: 'Contactado', color: '#f2c94c' } };
const ctx = vm.createContext({ esc, etapa: id => ETAPAS[id] || { nombre: id, color: '#888' }, gs: v => 'Gs ' + Number(v).toLocaleString('es-PY'),
  iniciales: n => n.split(' ').map(x => x[0]).slice(0, 2).join(''), S: { usuario: { rol: 'agente' } }, ic: n => `<i data-ic="${n}"></i>`, Date, JSON, Math, Number, String, Set, Object });
vm.runInContext(fuente + ';globalThis.historialVisual=historialVisual;', ctx);

// El caso de la captura: Cynthya transfiere (responsable, línea, responsable del cliente) y luego Víctor cambia la etapa.
const V = '6402209a-8a15-4983-9eb6-ebb4dd969cc0', C = '9cd0852a-3017-4dcf-970d-8e088a27a6d9', N = '83063f9c-9f90-4144-b9e2-28eeb359c863';
const t = m => new Date(Date.UTC(2026, 10, 10, 18, m)).toISOString();
const html = ctx.historialVisual({
  cambios: [
    { entidad: 'negociaciones', entidad_id: N, operacion: 'UPDATE', campo: 'etapa', anterior: 'espera', nuevo: 'contactado', usuario: 'impar.victor.torales', usuario_id: V, ts: t(41) },
    { entidad: 'contactos', entidad_id: N, operacion: 'UPDATE', campo: 'responsable_id', anterior: C, nuevo: V, usuario: 'impar.cynthya.torales', usuario_id: null, ts: t(37) },
    { entidad: 'negociaciones', entidad_id: N, operacion: 'UPDATE', campo: 'linea', anterior: 'Línea 1', nuevo: 'Ventas', usuario: 'impar.cynthya.torales', usuario_id: null, ts: t(37) },
    { entidad: 'negociaciones', entidad_id: N, operacion: 'UPDATE', campo: 'agente_id', anterior: C, nuevo: V, usuario: 'impar.cynthya.torales', usuario_id: null, ts: t(37) }
  ],
  personas: { [V]: 'Víctor Torales', [C]: 'Cynthya Torales' },
  autores: { 'impar.cynthya.torales': 'Cynthya Torales' },
  actividad: [{ txt: '⇄ Transferida de Cynthya Torales a Víctor Torales', por: 'Cynthya Torales', ts: t(37) },
    { txt: 'Cliente respondió por whatsapp → Cliente espera una respuesta', por: 'Sistema', ts: t(20) }]
});
assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}-/.test(html), 'Sin identificadores internos');
assert.ok(!html.includes('impar.cynthya') && html.includes('Cynthya Torales') && html.includes('Víctor Torales'), 'Nombres de personas, no usuarios');
assert.ok(html.includes('Transfirió la negociación a <b>Víctor Torales</b>') && html.includes('Antes la tenía <b>Cynthya Torales</b>'), 'La transferencia en una frase');
assert.ok(html.includes('Pasó a la línea <b>Ventas</b>') && html.includes('El cliente pasa a ser de <b>Víctor Torales</b>'), 'Detalles del mismo momento juntos');
assert.equal((html.match(/Transferida de/g) || []).length, 0, 'La actividad repetida no se muestra dos veces');
assert.ok(html.includes('class="hv-etapa" style="--c:#f2c94c">Contactado') && html.includes('Estaba en'), 'Etapas con su color');
assert.ok(html.includes('Cliente respondió por whatsapp'), 'La actividad del sistema queda en la misma línea de tiempo');
assert.equal((html.match(/class="hv-momento/g) || []).length, 3, 'Tres momentos: cambio de etapa, transferencia y respuesta del cliente');
assert.ok(html.indexOf('Pasó a') < html.indexOf('Transfirió'), 'Del más nuevo al más viejo');
assert.ok(!html.includes('Datos técnicos'), 'Los datos técnicos solo los ve administración');
assert.equal(ctx.historialVisual({}), '<p class="hv-vacio">Todavía no hay movimientos en esta negociación.</p>');

const colab = leer('src/colaboracion.mjs'), ficha = leer('public/js/ficha.js');
assert.ok(colab.includes('personas, autores') && colab.includes('NOT ${NOTA_REENVIO_SQL}'), 'El servidor manda nombres y actividad con el mismo filtro de la ficha');
assert.ok(leer('public/js/colaboracion.js').includes('box.innerHTML=historialVisual(result);') && ficha.includes('id="f-cambios" class="hv"'), 'La ficha usa la línea de tiempo');
assert.ok(leer('public/index.html').includes('/historial.css?v='));
console.log('✔ IMPAR: historial en línea de tiempo, con nombres, etapas en color y sin datos técnicos para el equipo.');
