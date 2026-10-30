/** IMPAR · Ediciones cifradas de WhatsApp (secretEncryptedMessage, MESSAGE_EDIT).
 * Cifrado real con el algoritmo de whatsmeow y el proto real de Baileys. Datos ficticios. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { hkdfSync, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import vm from 'node:vm';

const { proto, normalizeMessageContent } = await import('@whiskeysockets/baileys');
const leer = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const ba = leer('src/channels/baileys.mjs');
const i = ba.indexOf('// Máximo 3 descargas en paralelo:'), f = ba.indexOf('async function bajarMedia(', i);
const codigo = ba.slice(i, f).replace(
  /const despertarWorker=\(\)=>import\('\.\.\/worker\.mjs'\)[\s\S]*?\.catch\(e=>console\.warn\('\[wa:recepcion\] Worker inmediato:',e\.name\)\);/,
  'const despertarWorker=()=>{};');

function entorno() {
  const mensajes = new Map(), inbox = new Map();
  const q = async (sql, a) => {
    if (sql.startsWith('INSERT INTO inbox')) {
      if (inbox.has(a[2])) return { rows: [] };
      inbox.set(a[2], { txt: a[5], payload: JSON.parse(a[7]) });
      // El worker lo pasa a la conversación.
      mensajes.set(a[2], { txt: a[5], neg: 'neg-1' });
      return { rows: [{ id: inbox.size }] };
    }
    if (sql.startsWith('UPDATE mensajes SET editado')) {
      const m = mensajes.get(a[1]);
      if (!m || (m.editado?.ts || 0) >= a[3]) return { rows: [] };
      m.editado = { original: m.editado?.original ?? m.txt, veces: (m.editado?.veces || 0) + 1, ts: a[3] };
      m.txt = a[2];
      return { rows: [{ negociacion_id: m.neg }] };
    }
    return { rows: [] };
  };
  const sesiones = new Map([['c', {}]]);
  const ctx = vm.createContext({ q, console, sesiones, Promise, Date, Number, String, JSON, Object, Buffer, Map, Set,
    process, hkdfSync, createDecipheriv, setTimeout: () => 0, clearTimeout() {}, emitir() {},
    parejaDesdeEventoWA: () => null, registrarParejaWA: async () => true, bajarMedia: async () => null });
  vm.runInContext(codigo + ';globalThis.t={recibir,secretosMensajes};', ctx);
  return { ...ctx.t, mensajes, inbox, sesiones };
}
const mod = { proto, normalizeMessageContent };
const canal = { id: 'c', empresa_id: 'impar' };

// Cifrar una edición como lo hace WhatsApp (whatsmeow generateMsgSecretKey, "Message Edit", sin AAD).
function cifrarEdicion({ secreto, idOriginal, autor, editor, nuevo }) {
  const clave = Buffer.from(hkdfSync('sha256', secreto, Buffer.alloc(0), Buffer.from(idOriginal + autor + editor + 'Message Edit'), 32));
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', clave, iv);
  const plano = proto.Message.encode(proto.Message.fromObject(nuevo)).finish();
  const datos = Buffer.concat([c.update(plano), c.final(), c.getAuthTag()]);
  return { encPayload: datos, encIv: iv, secretEncType: 2, targetMessageKey: { id: idOriginal, fromMe: true, remoteJid: '595971000000@s.whatsapp.net' } };
}
const PN = '595981000001@s.whatsapp.net', LID = '123456789012345@lid';

// 1) Cliente con PN: el original llega, se edita, el CRM descifra y actualiza.
{
  const e = entorno();
  const secreto = randomBytes(32);
  await e.recibir(mod, { key: { id: 'ORIG1', remoteJid: PN, fromMe: false }, messageTimestamp: 1800000000,
    message: { conversation: 'Quiero 2 resmas', messageContextInfo: { messageSecret: secreto } } }, canal, 'c');
  assert.equal(e.mensajes.get('ORIG1').txt, 'Quiero 2 resmas');
  assert.equal(e.secretosMensajes.size, 1, 'Clave del original guardada en memoria');
  const sec = cifrarEdicion({ secreto, idOriginal: 'ORIG1', autor: PN, editor: PN, nuevo: { conversation: 'Quiero 5 resmas' } });
  await e.recibir(mod, { key: { id: 'EDIT1', remoteJid: PN, fromMe: false }, messageTimestamp: 1800000060,
    message: { secretEncryptedMessage: sec, messageContextInfo: { messageSecret: randomBytes(32) } } }, canal, 'c');
  assert.equal(e.mensajes.get('ORIG1').txt, 'Quiero 5 resmas');
  assert.equal(e.mensajes.get('ORIG1').editado.original, 'Quiero 2 resmas');
  assert.equal(e.inbox.size, 1, 'La edición no se guarda como mensaje nuevo');
  assert.equal(e.sesiones.get('c').edicionesWA, 1);
  assert.equal(e.secretosMensajes.size, 1, 'La edición no agrega su propia clave');
}

// 2) Migración a LID: original con LID y PN alternativo; WhatsApp cifra con el PN. Se encuentra la combinación.
{
  const e = entorno();
  const secreto = randomBytes(32);
  await e.recibir(mod, { key: { id: 'ORIG2', remoteJid: LID, senderPn: PN, fromMe: false }, messageTimestamp: 1800000000,
    message: { extendedTextMessage: { text: 'Retiro mañana' }, messageContextInfo: { messageSecret: secreto } } }, canal, 'c');
  const sec = cifrarEdicion({ secreto, idOriginal: 'ORIG2', autor: PN, editor: LID, nuevo: { extendedTextMessage: { text: 'Retiro el viernes' } } });
  await e.recibir(mod, { key: { id: 'EDIT2', remoteJid: LID, fromMe: false }, messageTimestamp: 1800000060,
    message: { secretEncryptedMessage: sec } }, canal, 'c');
  assert.equal(e.mensajes.get('ORIG2').txt, 'Retiro el viernes');
}

// 3) Sin clave (p. ej. reinicio del CRM) o clave equivocada: se registra el motivo, sin mensajes basura.
{
  const e = entorno();
  const sec = cifrarEdicion({ secreto: randomBytes(32), idOriginal: 'DESCONOCIDO', autor: PN, editor: PN, nuevo: { conversation: 'x' } });
  await e.recibir(mod, { key: { id: 'EDIT3', remoteJid: PN, fromMe: false }, message: { secretEncryptedMessage: sec } }, canal, 'c');
  await e.recibir(mod, { key: { id: 'ORIG4', remoteJid: PN, fromMe: false },
    message: { conversation: 'hola', messageContextInfo: { messageSecret: randomBytes(32) } } }, canal, 'c');
  const falsa = cifrarEdicion({ secreto: randomBytes(32), idOriginal: 'ORIG4', autor: PN, editor: PN, nuevo: { conversation: 'alterado' } });
  await e.recibir(mod, { key: { id: 'EDIT4', remoteJid: PN, fromMe: false }, message: { secretEncryptedMessage: falsa } }, canal, 'c');
  assert.equal(e.mensajes.get('ORIG4').txt, 'hola', 'Una edición que no autentica no cambia nada');
  const motivos = Object.fromEntries(e.sesiones.get('c').edicionesIgnoradas);
  assert.deepEqual(JSON.parse(JSON.stringify(motivos)), { secreta_sin_clave: 1, secreta_no_descifrada: 1 });
  assert.equal(e.inbox.size, 1);
  assert.ok(!(e.sesiones.get('c').tiposNoAdmitidos?.size), 'Ya no figura como no admitido');
}

// 4) La clave vive solo en memoria: no se escribe en la base ni en logs.
assert.ok(!/secreto[^\n]*q\(|INSERT[^\n]*secret/i.test(ba), 'Sin persistir claves de mensajes');
assert.ok(ba.includes("'Message Edit'") && ba.includes("createDecipheriv('aes-256-gcm'"));

console.log('✔ IMPAR: ediciones cifradas de WhatsApp descifradas y aplicadas (PN y LID), sin guardar claves en disco.');
