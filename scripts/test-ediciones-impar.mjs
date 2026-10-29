/** IMPAR · Mensajes editados por clientes en WhatsApp. Datos ficticios, sin sesión real. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const leer = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const ba = leer('src/channels/baileys.mjs');
const i = ba.indexOf('// Máximo 3 descargas en paralelo:'), f = ba.indexOf('async function bajarMedia(', i);
assert.ok(i > 0 && f > i);
const codigo = ba.slice(i, f).replace(
  /const despertarWorker=\(\)=>import\('\.\.\/worker\.mjs'\)[\s\S]*?\.catch\(e=>console\.warn\('\[wa:recepcion\] Worker inmediato:',e\.name\)\);/,
  'const despertarWorker=()=>{despertados++};');

function entorno() {
  const mensajes = new Map(), inbox = new Map(), eventos = [];
  const q = async (sql, a) => {
    if (sql.startsWith('UPDATE mensajes SET editado')) {
      const m = mensajes.get(a[1]);
      if (!m || (m.editado?.ts || 0) >= a[3]) return { rows: [] };
      m.editado = { original: m.editado?.original ?? m.txt, veces: (m.editado?.veces || 0) + 1, ts: a[3] };
      m.txt = a[2];
      return { rows: [{ negociacion_id: m.neg }] };
    }
    if (sql.startsWith('UPDATE inbox SET payload')) {
      const r = inbox.get(a[1]);
      if (!r || !['pendiente', 'capturando', 'cuarentena'].includes(r.estado) || (r.payload.editado?.ts || 0) >= a[3]) return { rows: [] };
      r.payload.editado = { original: r.payload.editado?.original ?? r.txt, veces: (r.payload.editado?.veces || 0) + 1, ts: a[3] };
      r.txt = a[2];
      return { rows: [{ id: r.id }] };
    }
    if (sql.startsWith('INSERT INTO inbox')) {
      if (inbox.has(a[2])) return { rows: [] };
      if (sql.includes('WHERE NOT EXISTS(SELECT 1 FROM mensajes') && mensajes.has(a[2])) return { rows: [] };
      inbox.set(a[2], { id: inbox.size + 1, txt: a[5], remitente: a[3], payload: JSON.parse(a[7]), estado: a[8] });
      return { rows: [{ id: inbox.size }] };
    }
    return { rows: [] };
  };
  const sesiones = new Map([['c', {}]]);
  const ctx = vm.createContext({ q, console, sesiones, Promise, Date, Number, String, JSON, Object, process,
    setTimeout: () => 0, clearTimeout() {}, emitir: (_e, t, d) => eventos.push([t, d.id]),
    parejaDesdeEventoWA: () => null, registrarParejaWA: async () => true, bajarMedia: async () => null, despertados: 0 });
  vm.runInContext(codigo + ';globalThis.t={recibirEdicion};', ctx);
  return { ...ctx.t, mensajes, inbox, eventos, sesiones, ctx };
}
const canal = { id: 'c', empresa_id: 'impar' };
const mod = { normalizeMessageContent: x => x };
const edicion = (id, texto, ts, extra = {}) => ({
  key: { id, remoteJid: '595981000001@s.whatsapp.net', fromMe: false, ...extra },
  update: { message: { editedMessage: { message: { conversation: texto } } }, messageTimestamp: ts }
});

// 1) Mensaje ya en la conversación: texto nuevo, original conservado, conversación actualizada.
{
  const e = entorno();
  e.mensajes.set('M1', { txt: 'Quiero 2 resmas', neg: 'neg-1' });
  assert.equal(await e.recibirEdicion(mod, edicion('M1', 'Quiero 5 resmas', 1800000100), canal, 'c'), true);
  assert.equal(e.mensajes.get('M1').txt, 'Quiero 5 resmas');
  assert.equal(e.mensajes.get('M1').editado.original, 'Quiero 2 resmas');
  assert.deepEqual(e.eventos, [['neg:patch', 'neg-1']]);
  // Segunda edición: conserva el primer original y cuenta.
  await e.recibirEdicion(mod, edicion('M1', 'Quiero 6 resmas', 1800000200), canal, 'c');
  assert.equal(e.mensajes.get('M1').editado.original, 'Quiero 2 resmas');
  assert.equal(e.mensajes.get('M1').editado.veces, 2);
  // Una edición atrasada no pisa a la más nueva.
  await e.recibirEdicion(mod, edicion('M1', 'Quiero 3 resmas', 1800000150), canal, 'c');
  assert.equal(e.mensajes.get('M1').txt, 'Quiero 6 resmas');
  assert.equal(e.inbox.size, 0, 'Una edición atrasada no crea un mensaje duplicado');
  assert.equal(e.sesiones.get('c').edicionesWA, 2, 'Solo cuenta ediciones aplicadas');
}

// 2) Todavía en cola: se corrige antes de llegar a la conversación.
{
  const e = entorno();
  e.inbox.set('M2', { id: 1, txt: 'Hola, soy de Lambare', payload: { ts: 1 }, estado: 'pendiente' });
  await e.recibirEdicion(mod, edicion('M2', 'Hola, soy de Lambaré', 1800000100), canal, 'c');
  assert.equal(e.inbox.get('M2').txt, 'Hola, soy de Lambaré');
  assert.equal(e.inbox.get('M2').payload.editado.original, 'Hola, soy de Lambare');
  assert.equal(e.ctx.despertados, 1);
}

// 3) El original nunca llegó: la versión editada entra igual, con el ID original (sin duplicar después).
{
  const e = entorno();
  await e.recibirEdicion(mod, edicion('M3', 'Necesito cartulina', 1800000100), canal, 'c');
  const r = e.inbox.get('M3');
  assert.equal(r.txt, 'Necesito cartulina');
  assert.equal(r.remitente, '595981000001');
  assert.equal(r.estado, 'pendiente');
  assert.deepEqual(JSON.parse(JSON.stringify(r.payload.editado)), { original: null, veces: 1, ts: 1800000100000 });
}

// 4) Ignorar: ediciones propias, grupos, estados y ediciones sin texto.
{
  const e = entorno();
  e.mensajes.set('M4', { txt: 'x', neg: 'n' });
  assert.equal(await e.recibirEdicion(mod, edicion('M4', 'y', 1800000100, { fromMe: true }), canal, 'c'), false);
  assert.equal(await e.recibirEdicion(mod, edicion('M4', 'y', 1800000100, { remoteJid: '1203@g.us' }), canal, 'c'), false);
  assert.equal(await e.recibirEdicion(mod, edicion('M4', 'y', 1800000100, { remoteJid: 'status@broadcast' }), canal, 'c'), false);
  assert.equal(await e.recibirEdicion(mod, edicion('M4', '   ', 1800000100), canal, 'c'), false);
  assert.equal(e.mensajes.get('M4').txt, 'x');
  assert.equal(e.inbox.size, 0);
}

// 5) La edición llega por messages.upsert (protocolMessage) y también por messages.update: se aplica una vez.
{
  const e = entorno();
  vm.runInContext('globalThis.r=recibir;', e.ctx);
  e.mensajes.set('M5', { txt: 'Retiro mañana', neg: 'neg-5' });
  const upsert = { key: { id: 'PROTO-1', remoteJid: '595981000001@s.whatsapp.net', fromMe: false }, messageTimestamp: 1800000300,
    message: { protocolMessage: { type: 14, key: { id: 'M5', fromMe: true }, timestampMs: 1800000300123,
      editedMessage: { conversation: 'Retiro el viernes' } } } };
  await e.ctx.r(mod, upsert, canal, 'c');
  assert.equal(e.mensajes.get('M5').txt, 'Retiro el viernes');
  assert.equal(e.mensajes.get('M5').editado.original, 'Retiro mañana');
  assert.equal(e.inbox.size, 0, 'El protocolMessage no se guarda como mensaje nuevo');
  await e.recibirEdicion(mod, edicion('M5', 'Retiro el viernes', 1800000300), canal, 'c');
  assert.equal(e.mensajes.get('M5').editado.veces, 1, 'No se aplica dos veces');
  assert.equal(e.sesiones.get('c').edicionesWA, 1, 'Contador sin duplicar');
  // Otros protocolMessage (p. ej. borrados) no generan mensajes.
  await e.ctx.r(mod, { key: { id: 'PROTO-2', remoteJid: '595981000001@s.whatsapp.net', fromMe: false },
    message: { protocolMessage: { type: 0, key: { id: 'M5' } } } }, canal, 'c');
  assert.equal(e.inbox.size, 0);
}

// 6) Integración.
{
  assert.ok(ba.includes('if (cambio?.update?.message?.editedMessage) {') && ba.includes('recibirEdicion(mod,cambio,canal,id)'),
    'messages.update deriva ediciones sin tocar acuses');
  assert.ok(ba.includes('ediciones=${S.edicionesWA||0}'), 'Contador de ediciones en el log');
  assert.ok(leer('src/worker.mjs').includes('editado: m.payload?.editado || null'), 'Worker pasa la edición');
  const core = leer('src/core.mjs');
  assert.equal((core.match(/remitente_numero,cita,editado\)/g) || []).length, 2, 'Ambas inserciones guardan la edición');
  const sql = leer('src/migrations/027_mensajes_editados_impar.sql');
  assert.ok(sql.includes('ALTER TABLE mensajes ADD COLUMN IF NOT EXISTS editado JSONB'));
  assert.ok(!/\b(DROP|DELETE|TRUNCATE|UPDATE)\b/i.test(sql), 'Migración solo aditiva');
  const ficha = leer('public/js/ficha.js');
  assert.ok(ficha.includes('${editadoHTML(m.editado)}') && ficha.includes('esc(e.original)'), 'Edición visible y escapada');
}

console.log('✔ IMPAR: ediciones de clientes visibles, ordenadas y con el texto original.');
