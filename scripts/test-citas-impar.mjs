/** IMPAR · Respuestas citadas: cliente → CRM y CRM → cliente. Datos ficticios, sin red ni sesión real. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { resolverCitaEntrante, citaParaEnvio, vistaPrevia } from '../src/citas-impar.mjs';

const leer = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const ba = leer('src/channels/baileys.mjs');
const plano = x => JSON.parse(JSON.stringify(x));
const tramo = (src, desde, hasta) => {
  const i = src.indexOf(desde), f = src.indexOf(hasta, i + 1);
  assert.ok(i >= 0 && f > i, 'Tramo localizado: ' + desde);
  return src.slice(i, f);
};

// 1) Baileys: el cliente responde citando → la cita viaja en el payload de inbox.
{
  let codigo = tramo(ba, '// Máximo 3 descargas en paralelo:', 'async function bajarMedia(').replace(
    /const despertarWorker=\(\)=>import\('\.\.\/worker\.mjs'\)[\s\S]*?\.catch\(e=>console\.warn\('\[wa:recepcion\] Worker inmediato:',e\.name\)\);/,
    'const despertarWorker=()=>{};');
  const filas = [];
  const q = async (sql, a) => {
    if (sql.startsWith('INSERT INTO inbox')) { filas.push({ txt: a[5], payload: JSON.parse(a[7]) }); return { rows: [{ id: filas.length }] }; }
    return { rows: [] };
  };
  const sesiones = new Map([['c', { numero: '595971000000', lid: '88990011' }]]);
  const ctx = vm.createContext({ q, console, sesiones, Promise, Date, Number, String, JSON, Object, process,
    setTimeout: () => 0, clearTimeout() {}, emitir() {}, parejaDesdeEventoWA: () => null,
    registrarParejaWA: async () => true, bajarMedia: async () => null });
  vm.runInContext(codigo + ';globalThis.t={recibir,extraerCita};', ctx);
  const canal = { id: 'c', empresa_id: 'impar' }, mod = { normalizeMessageContent: x => x };
  const key = id => ({ id, remoteJid: '595981000001@s.whatsapp.net', fromMe: false });
  await ctx.t.recibir(mod, { key: key('IN-2'), message: { extendedTextMessage: { text: 'Sí, ese',
    contextInfo: { stanzaId: 'OUT-ABC1', participant: '595971000000@s.whatsapp.net',
      quotedMessage: { conversation: 'Tenemos resmas A4 a 45.000' } } } } }, canal, 'c');
  assert.equal(filas[0].txt, 'Sí, ese');
  assert.deepEqual(plano(filas[0].payload.cita), { ext: 'OUT-ABC1', txt: 'Tenemos resmas A4 a 45.000', dir: 'out' },
    'Cita de un mensaje nuestro');
  await ctx.t.recibir(mod, { key: key('IN-3'), message: { imageMessage: { caption: 'así',
    contextInfo: { stanzaId: 'IN-1', participant: '595981000001@s.whatsapp.net', quotedMessage: { imageMessage: {} } } } } }, canal, 'c');
  assert.deepEqual(plano(filas[1].payload.cita), { ext: 'IN-1', txt: '📷 Imagen', dir: 'in' }, 'Cita de su propio adjunto');
  await ctx.t.recibir(mod, { key: key('IN-4'), message: { conversation: 'sin cita' } }, canal, 'c');
  assert.equal(filas[2].payload.cita, undefined, 'Sin cita no agrega datos');
  assert.equal(ctx.t.extraerCita({ extendedTextMessage: { contextInfo: { stanzaId: 'X1', participant: '88990011@lid', quotedMessage: {} } } }, ['595971000000', '88990011']).dir,
    'out', 'Reconoce nuestro LID');
}

// 2) Baileys: el agente responde citando → sendMessage recibe quoted con el ID original.
{
  const fuente = tramo(ba, 'export async function enviar(', 'export async function desvincular(').replace(/^export /, '');
  const envios = [];
  const sock = { sendMessage: async (jid, contenido, opciones) => { envios.push({ jid, contenido, opciones }); return { key: { id: 'NUEVO' + envios.length } }; } };
  const sesiones = new Map([['c', { sock, estado: 'conectado' }]]);
  const ctx = vm.createContext({ sesiones, process, console, String, Error,
    rutaParaEnvioWA: async (_c, jid) => ({ destino: jid }), guardarOriginal: async () => true,
    cargarBaileys: async () => ({ proto: {} }), q: async () => ({ rows: [] }),
    readFileSync: () => Buffer.from('x'), join: (...p) => p.join('/'), MEDIA_DIR: '/m' });
  vm.runInContext(fuente + ';globalThis.enviar=enviar;', ctx);
  const canal = { id: 'c', empresa_id: 'impar', config: {} };
  await ctx.enviar(canal, '0981000001', 'Te confirmo', null, { cita: { id: 7, ext: 'IN-1', dir: 'in', txt: '¿Tienen cartulina?' } });
  assert.equal(envios[0].jid, '595981000001@s.whatsapp.net');
  assert.deepEqual(plano(envios[0].opciones.quoted), { key: { remoteJid: '595981000001@s.whatsapp.net', id: 'IN-1', fromMe: false },
    message: { conversation: '¿Tienen cartulina?' } });
  await ctx.enviar(canal, '0981000001', 'Sí', null, { cita: { id: 8, ext: 'OUT-9', dir: 'out', txt: 'Hola' } });
  assert.equal(envios[1].opciones.quoted.key.fromMe, true, 'Citar un mensaje nuestro');
  await ctx.enviar(canal, '0981000001', 'Normal', null);
  assert.equal(envios[2].opciones, undefined, 'Sin cita se envía igual que antes');
  await ctx.enviar(canal, '0981000001', 'Texto del audio', { tipo: 'audio', archivo: 'a.ogg', mime: 'audio/ogg' }, { cita: { ext: 'IN-1', dir: 'in', txt: 'x' } });
  assert.ok(envios[3].opciones?.quoted && envios[4].opciones === undefined, 'Solo el primer envío lleva la cita');
}

// 3) Cloud API: context.message_id en el primer envío.
{
  const meta = leer('src/channels/meta.mjs');
  const fuente = tramo(meta, 'export async function enviarWhatsAppAPI(', 'export async function enviarMeta(').replace(/^export /, '');
  const cuerpos = [];
  const ctx = vm.createContext({ process, JSON, String, Error, WA_API: 'https://graph.test',
    resolverToken: () => 'token', urlPublica: u => 'https://crm.test' + u,
    fetch: async (_u, o) => { cuerpos.push(JSON.parse(o.body)); return { ok: true, json: async () => ({ messages: [{ id: 'wamid.X' }] }) }; } });
  vm.runInContext(fuente + ';globalThis.enviar=enviarWhatsAppAPI;', ctx);
  const canal = { config: { phone_number_id: '1', token: 't' } };
  await ctx.enviar(canal, '0981000001', 'Respuesta', null, { cita: { ext: 'wamid.ORIGINAL', dir: 'in' } });
  assert.deepEqual(plano(cuerpos[0].context), { message_id: 'wamid.ORIGINAL' });
  assert.equal(cuerpos[0].text.body, 'Respuesta');
  await ctx.enviar(canal, '0981000001', 'Sin cita', null);
  assert.equal(cuerpos[1].context, undefined);
  assert.ok(meta.includes("m.context?.id ? { cita: { ext: String(m.context.id).slice(0, 180)"), 'Cloud API recibe citas');
}

// 4) Vínculo con el mensaje del CRM y validación de pertenencia.
{
  const consultas = [];
  const q = async (sql, p) => {
    consultas.push({ sql, p });
    if (sql.includes('UNION ALL')) return { rows: p[1] === 'OUT-ABC1' ? [{ id: 41, dir: 'out', txt: 'Tenemos  resmas\nA4', media_tipo: null }] : [] };
    if (sql.includes('n.contacto_id=$3')) {
      if (p[2] !== 'cliente-1') return { rows: [] };
      return { rows: p[0] === '41' ? [{ id: 41, dir: 'out', txt: 'Hola', media_tipo: null, msg_id: null, wa_salida: 'OUT-ABC1' }]
        : [{ id: 42, dir: 'in', txt: '', media_tipo: 'imagen', msg_id: 'IN-1', wa_salida: null }] };
    }
    return { rows: [] };
  };
  assert.deepEqual(await resolverCitaEntrante(q, 'impar', { ext: 'OUT-ABC1', txt: 'x', dir: 'out' }),
    { id: 41, ext: 'OUT-ABC1', dir: 'out', txt: 'Tenemos resmas A4' }, 'Vincula con nuestro mensaje enviado');
  assert.deepEqual(await resolverCitaEntrante(q, 'impar', { ext: 'NO-EXISTE', txt: 'Hola de antes', dir: 'in' }),
    { id: null, ext: 'NO-EXISTE', dir: 'in', txt: 'Hola de antes' }, 'Cita no registrada conserva la vista previa');
  assert.equal(await resolverCitaEntrante(q, 'impar', { ext: "x'; DROP" }), null, 'ID inválido descartado');
  assert.deepEqual(await citaParaEnvio(q, 'impar', 'cliente-1', 41), { id: 41, ext: 'OUT-ABC1', dir: 'out', txt: 'Hola' });
  assert.deepEqual(await citaParaEnvio(q, 'impar', 'cliente-1', '42'), { id: 42, ext: 'IN-1', dir: 'in', txt: '📷 Imagen' });
  await assert.rejects(citaParaEnvio(q, 'impar', 'otro-cliente', 41), /no pertenece a esta conversación/);
  await assert.rejects(citaParaEnvio(q, 'impar', 'cliente-1', '1 OR 1=1'), /no válido/);
  assert.equal(await citaParaEnvio(q, 'impar', 'cliente-1', null), null);
  assert.equal(vistaPrevia('a'.repeat(400)).length, 300);
}

// 5) Integración: worker, ingesta, ruta, migración y chat.
{
  const worker = leer('src/worker.mjs'), core = leer('src/core.mjs'), ruta = leer('src/routes/negociaciones.mjs');
  assert.ok(worker.includes('cita: m.payload?.cita || null'), 'Worker pasa la cita recibida');
  assert.ok(worker.includes('baileys.enviar(canal, o.destino, cuerpo, adjunto, opcionesEnvio)'), 'Worker envía cita por QR');
  assert.ok(worker.includes('meta.enviarWhatsAppAPI(canal, o.destino, cuerpo, adjunto, opcionesEnvio)'), 'Worker envía cita por Cloud API');
  assert.equal((core.match(/remitente_numero,cita[,)]/g) || []).length, 2, 'Ambas inserciones guardan la cita');
  assert.ok(core.includes('.catch(e => { console.warn(\'[citas] Vínculo no resuelto:\', e.name); return null; })'),
    'Una cita fallida no bloquea el mensaje');
  const iRuta = ruta.indexOf("r.post('/:id/mensajes'"), iCita = ruta.indexOf('citaParaEnvio(q', iRuta), iBot = ruta.indexOf('botAutoOff', iRuta);
  assert.ok(iCita > iRuta && iCita < iBot, 'La cita se valida antes de cambiar etapa o bot');
  const sql = leer('src/migrations/026_citas_mensajes_impar.sql');
  assert.ok(sql.includes('ALTER TABLE mensajes ADD COLUMN IF NOT EXISTS cita JSONB'));
  assert.ok(sql.includes('ALTER TABLE outbox ADD COLUMN IF NOT EXISTS cita JSONB'));
  assert.ok(!/\b(DROP|DELETE|TRUNCATE|UPDATE)\b/i.test(sql), 'Migración solo aditiva');
  const ficha = leer('public/js/ficha.js');
  assert.ok(ficha.includes('data-responder=') && ficha.includes('citaId: citaEnvio.id'), 'Botón Responder y envío con cita');
  assert.ok(ficha.includes('${citaHTML(m.cita)}') && ficha.includes('esc(c.txt'), 'Cita visible y escapada');
  assert.ok(leer('public/index.html').includes('/citas.css?v='), 'Estilos versionados');
}

console.log('✔ IMPAR: citas recibidas y enviadas por WhatsApp QR y Cloud API, vinculadas y validadas.');
