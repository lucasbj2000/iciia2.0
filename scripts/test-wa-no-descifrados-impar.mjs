/** IMPAR · Mensajes que WhatsApp entrega sin poder descifrarse (Bad MAC / No session).
 * Ninguno queda invisible: se espera el reenvío y, si no llega, se deja un aviso
 * que luego se reemplaza por el original. Datos ficticios, sin sesión real. */
import assert from 'node:assert/strict';
import { contenidoBaileys } from '../src/contenido-whatsapp-impar.mjs';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const leer = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const ba = leer('src/channels/baileys.mjs');
const inicio = ba.indexOf('// Máximo 3 descargas en paralelo:');
const fin = ba.indexOf('async function bajarMedia(', inicio);
assert.ok(inicio > 0 && fin > inicio, 'Receptor localizado');
let codigo = ba.slice(inicio, fin).replace(
  /const despertarWorker=\(\)=>import\('\.\.\/worker\.mjs'\)[\s\S]*?\.catch\(e=>console\.warn\('\[wa:recepcion\] Worker inmediato:',e\.name\)\);/,
  'const despertarWorker=()=>{despertados++};');
assert.ok(codigo.includes('const despertarWorker=()=>{despertados++};'));

function entorno() {
  const inbox = new Map(), mensajes = new Map(), eventos = [], timers = [];
  const q = async (sql, a = []) => {
    if (sql.startsWith('INSERT INTO inbox')) {
      if (inbox.has(a[2])) return { rows: [] };
      const fila = { id: inbox.size + 1, ext: a[2], remitente: a[3], txt: a[5], payload: JSON.parse(a[7]), estado: a[8] };
      inbox.set(a[2], fila);
      return { rows: [{ id: fila.id }] };
    }
    if (sql.startsWith('UPDATE inbox SET txt=$3')) {
      const f = inbox.get(a[1]);
      if (!f || f.payload.noDescifrado !== true) return { rows: [] };
      f.txt = a[2]; f.payload = { ...f.payload, noDescifrado: false, recuperadoTarde: true };
      return { rows: [{ id: f.id }] };
    }
    if (sql.startsWith('UPDATE mensajes SET txt=$3')) {
      const msj = mensajes.get(a[1]);
      if (!msj || msj.txt !== a[8]) return { rows: [] };
      msj.txt = a[2];
      return { rows: [{ negociacion_id: msj.neg }] };
    }
    return { rows: [] };
  };
  const sesiones = new Map([['c', { totalEntradas: 0 }]]);
  const ctx = vm.createContext({ contenidoBaileys,
    q, console: { log() {}, warn() {}, error() {} }, sesiones, Promise, Date, Number, String, JSON, process,
    setTimeout: (fn, ms) => { const t = { fn, ms, vivo: true }; timers.push(t); return t; },
    clearTimeout: t => { if (t) t.vivo = false; },
    emitir: (_e, tipo, d) => eventos.push([tipo, d.id]),
    parejaDesdeEventoWA: () => null, registrarParejaWA: async () => true, modoDesdeEventoWA: () => null, registrarModoEntranteWA: async () => false,
    bajarMedia: async () => null, despertados: 0
  });
  vm.runInContext(codigo + ';globalThis.t={recibir,AVISO_NO_DESCIFRADO,ESPERA_DESCIFRADO_MS};', ctx);
  const vencer = async ms => {
    for (const t of timers.filter(t => t.vivo && t.ms === ms)) { t.vivo = false; t.fn(); }
    for (let i = 0; i < 5; i++) await new Promise(setImmediate);
  };
  return { ...ctx.t, inbox, mensajes, eventos, timers, sesiones, vencer, ctx };
}
const canal = { id: 'c', empresa_id: 'impar', nombre: 'principal' };
const mod = { normalizeMessageContent: x => x, proto: { WebMessageInfo: { StubType: { CIPHERTEXT: 2 } } } };
const clave = id => ({ id, remoteJid: '595981000001@s.whatsapp.net', fromMe: false });
const cifrado = id => ({ key: clave(id), messageStubType: 2, messageStubParameters: ['Bad MAC'], messageTimestamp: 1800000000, pushName: 'Cliente' });
const original = (id, txt) => ({ key: clave(id), message: { conversation: txt }, messageTimestamp: 1800000000, pushName: 'Cliente' });

// 1) El reenvío llega dentro de la espera: un único mensaje, real, sin aviso.
{
  const e = entorno();
  assert.equal(e.ESPERA_DESCIFRADO_MS, 60000);
  await e.recibir(mod, cifrado('A'), canal, 'c');
  assert.equal(e.inbox.size, 0, 'No se registra nada mientras se espera el reenvío');
  await e.recibir(mod, original('A', 'Quiero 3 resmas'), canal, 'c');
  await e.vencer(60000);
  assert.equal(e.inbox.size, 1);
  assert.equal(e.inbox.get('A').txt, 'Quiero 3 resmas');
  const S = e.sesiones.get('c');
  assert.equal(S.recuperadosWA, 1);
  assert.equal(S.noDescifradosWA || 0, 0);
  assert.equal(S.noDescifrados.size, 0);
}

// 2) No llega a tiempo: aviso visible en la conversación; el original tardío lo reemplaza.
{
  const e = entorno();
  await e.recibir(mod, cifrado('B'), canal, 'c');
  await e.recibir(mod, cifrado('B'), canal, 'c');
  assert.equal(e.timers.filter(t => t.vivo && t.ms === 60000).length, 1, 'Un solo temporizador de aviso por mensaje');
  assert.equal(e.timers.filter(t => t.vivo && t.ms === 25000).length, 1, 'Un solo pedido al teléfono en curso');
  await e.vencer(60000);
  const fila = e.inbox.get('B');
  assert.equal(fila.txt, e.AVISO_NO_DESCIFRADO);
  assert.equal(fila.payload.noDescifrado, true);
  assert.equal(fila.remitente, '595981000001');
  assert.equal(fila.estado, 'pendiente', 'El worker lo lleva a la conversación del cliente');
  assert.equal(e.sesiones.get('c').noDescifradosWA, 1);
  assert.ok(e.ctx.despertados >= 1);
  // El worker ya lo ingresó como mensaje de la negociación.
  e.mensajes.set('B', { txt: e.AVISO_NO_DESCIFRADO, neg: 'neg-1' });
  await e.recibir(mod, original('B', 'Hola, ¿tienen cartulina?'), canal, 'c');
  assert.equal(e.inbox.size, 1, 'Sin duplicar');
  assert.equal(e.inbox.get('B').txt, 'Hola, ¿tienen cartulina?');
  assert.equal(e.mensajes.get('B').txt, 'Hola, ¿tienen cartulina?', 'La conversación muestra el texto real');
  assert.deepEqual(e.eventos, [['neg:patch', 'neg-1']]);
  assert.equal(e.sesiones.get('c').tardiosWA, 1);
  // Un mensaje editado a mano por un agente no se pisa: solo se reemplaza el aviso exacto.
  e.mensajes.get('B').txt = 'otro';
  await e.vencer(5000);
  assert.equal(e.mensajes.get('B').txt, 'otro');
}

// 3) Un duplicado normal (no aviso) sigue ignorándose.
{
  const e = entorno();
  await e.recibir(mod, original('C', 'uno'), canal, 'c');
  await e.recibir(mod, original('C', 'uno'), canal, 'c');
  assert.equal(e.inbox.size, 1);
  assert.equal(e.sesiones.get('c').tardiosWA || 0, 0);
}

// 4) Otros eventos vacíos, propios, grupos y estados no generan avisos.
{
  const e = entorno();
  await e.recibir(mod, { key: clave('D'), messageStubType: 1 }, canal, 'c');
  await e.recibir(mod, { ...cifrado('E'), key: { ...clave('E'), fromMe: true } }, canal, 'c');
  await e.recibir(mod, { ...cifrado('F'), key: { ...clave('F'), remoteJid: '1203@g.us' } }, canal, 'c');
  await e.recibir(mod, { ...cifrado('G'), key: { ...clave('G'), remoteJid: 'status@broadcast' } }, canal, 'c');
  await e.vencer(60000);
  assert.equal(e.inbox.size, 0);
}

// 5) Se insiste al celular de la línea con esperas crecientes y se deja de insistir al recuperarse.
{
  const e = entorno();
  const pedidos = [];
  e.sesiones.get('c').sock = { requestPlaceholderResend: async k => { pedidos.push(k.id); } };
  await e.recibir(mod, cifrado('H'), canal, 'c');
  await e.vencer(25000); await e.vencer(60000); await e.vencer(90000); await e.vencer(240000);
  assert.deepEqual(pedidos, ['H', 'H', 'H'], 'Tres pedidos al teléfono hasta los 4 minutos');
  assert.equal(e.inbox.get('H').txt, e.AVISO_NO_DESCIFRADO, 'Mientras tanto queda el aviso');
  e.mensajes.set('H', { txt: e.AVISO_NO_DESCIFRADO, neg: 'neg-2' });
  await e.recibir(mod, original('H', 'Foto del pedido'), canal, 'c');
  assert.equal(e.inbox.get('H').txt, 'Foto del pedido', 'El reenvío del teléfono reemplaza el aviso');
  assert.equal(e.timers.filter(t => t.vivo && [600000, 1800000].includes(t.ms)).length, 0, 'No se insiste más');
  assert.equal(e.sesiones.get('c').pedidosTelefono.size, 0);
  assert.equal(e.sesiones.get('c').pedidosTelefonoWA, 3);
}
// 6) Sin socket (reconectando) no falla y sigue programando.
{
  const e = entorno();
  await e.recibir(mod, cifrado('I'), canal, 'c');
  await e.vencer(25000);
  assert.equal(e.timers.filter(t => t.vivo && t.ms === 90000).length, 1);
}

assert.ok(ba.includes('pedidos_al_telefono='), 'Contador de pedidos en el log');
assert.ok(ba.includes('avisos_no_leidos=') && ba.includes('recuperados=') && ba.includes('tardios='),
  'Contadores en el log de recepción');
console.log('✔ IMPAR: mensajes no descifrables quedan visibles y se reemplazan al recuperarse.');
