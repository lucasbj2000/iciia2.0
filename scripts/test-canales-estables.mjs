/** Regresiones: Canal WhatsApp jamás reinicia toda Administración por SSE. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const leer = p => readFileSync(new URL('../'+p,import.meta.url),'utf8');
const app=leer('public/js/app.js');
const admin=leer('public/js/admin.js');
const wa=leer('src/channels/baileys.mjs');
const server=leer('src/routes/canales.mjs');

assert.ok(admin.includes('const solicitud = ++cargaCanalesSeq'), 'La vista debe descartar respuestas obsoletas');
assert.ok(admin.includes('AbortSignal.timeout(9000)'), 'La carga de canales requiere límite de espera');
assert.ok(admin.includes("id=\"canales-reintentar\""), 'La interfaz debe permitir reintentar tras error');
assert.ok(admin.includes('data-canal-id='), 'El estado debe actualizarse dentro de una tarjeta existente');
assert.ok(admin.includes("api('/canales/por-sucursal'"), 'El listado usa API de canales');
assert.ok(!admin.includes("get('/canales/por-sucursal'), get('/canales/webhook/info'), get('/admin/sucursales')"),
  'El webhook no debe bloquear conjuntamente con otros servicios');
assert.ok(admin.includes("  $, $$, esc, S, api, get, post,"),'Imports del selector correcto');
assert.ok(admin.includes("$$('[data-nuevo]').forEach"), 'Selector de añadir canal válido');
assert.ok(admin.includes("$$('[data-canal-id]').find"), 'Selección de canal individual válida');

const start=app.indexOf("es.addEventListener('canal:estado'");
const end=app.indexOf('es.onerror',start);
assert.ok(start>=0&&end>start,'Evento SSE de canales definido');
const callback=app.slice(start,end);
assert.ok(callback.includes('actualizarEstadoCanal'),'El evento debe modificar solo el indicador');
assert.ok(!/\brender\s*\(|\btoast\s*\(|\bvistaAdmin\s*\(/.test(callback),
  'El evento de canal NO debe reconstruir vista ni emitir notificaciones');
assert.ok(app.includes("if (n.tipo !== 'canal')"),'Notificaciones de canal solo al centro de avisos');

const inicio=admin.indexOf('export function actualizarEstadoCanal(');
const fin=admin.indexOf('\nfunction copiar(',inicio);
assert.ok(inicio>=0&&fin>inicio);
const src=admin.slice(inicio,fin).replace('export function','function');
function clases(){
  const s=new Set();
  return {toggle:(k,v)=>v?s.add(k):s.delete(k),contains:k=>s.has(k)};
}
const text={textContent:''},dot={style:{},classList:clases()};
const card={dataset:{canalId:'test-canal'},classList:clases(),
  querySelector:k=>k==='[data-canal-estado-texto]'?text:
    k==='[data-canal-estado-etiqueta] .dot'?dot:null};
const S={vista:'adm'};
const $$=()=>[card];
vm.runInNewContext(src+';actualizarEstadoCanal({canalId:"test-canal",estado:"reconectando"});',
  {S,$$,TADM:'canales'});
assert.equal(text.textContent,'Reconectando…');
assert.equal(dot.style.background,'var(--warn)');
vm.runInNewContext(src+';actualizarEstadoCanal({canalId:"test-canal",estado:"conectado"});',
  {S,$$,TADM:'canales'});
assert.equal(text.textContent,'Conectado');
assert.equal(dot.style.background,'var(--ok)');
assert.equal(card.classList.contains('conectado'),true);
assert.equal(dot.classList.contains('live'),true);

assert.ok(wa.includes('if (S.sock !== sock) return'), 'Eventos de socket antiguo se ignoran');
assert.ok(wa.includes("if (S?.reintentoTimer) return estadoSesion(id)"),
  'El temporizador de reconexión impide iniciar sockets paralelos');
assert.ok(wa.includes('S.reintentoTimer = setTimeout'), 'Los reintentos deben controlarse con timer por canal');
assert.ok(wa.includes('if (S) S.sock = null'), 'Desvincular anula eventos pendientes');
assert.ok(wa.includes("estado:S.estado"),'Se informa reconectando en vez de falsa desvinculación');
assert.ok(server.includes("baileys.estadoSesion(c.id)"),'API lista estados reales de sockets');
console.log('✔ Cargas, estados SSE y avisos de WhatsApp controlados.');
