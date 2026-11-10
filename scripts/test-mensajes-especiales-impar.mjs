// IMPAR: todo lo que llega por WhatsApp, Messenger o Instagram se ve completo y en español.
// Las reacciones y avisos de WhatsApp quedan en la conversación sin pasarla a «Cliente espera respuesta».
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { contenidoCloud, contenidoBaileys, textoAdjuntoMeta, textoAnuncio, textoAdjuntoFallido, textoPedido, textoFormulario } from '../src/contenido-whatsapp-impar.mjs';
const leer = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');

// --- Línea verificada (Cloud API) ---
const r = contenidoCloud({ type: 'reaction', reaction: { message_id: 'wamid.X', emoji: '👍' } });
assert.deepEqual(r, { texto: 'Reaccionó con 👍', especial: 'reaccion', citaExt: 'wamid.X' }, 'La reacción del caso reportado');
assert.equal(contenidoCloud({ type: 'reaction', reaction: { message_id: 'wamid.X', emoji: '' } }).texto, 'Quitó su reacción');
assert.equal(contenidoCloud({ type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: '1', title: 'Resmas A4', description: 'Caja x 5' } } }).texto, 'Resmas A4 — Caja x 5');
assert.equal(contenidoCloud({ type: 'button', button: { text: 'Sí, quiero' } }).texto, 'Sí, quiero');
const form = textoFormulario({ name: 'flow', response_json: '{"flow_token":"secreto","nombre_completo":"Ana","cantidad":"3"}' });
assert.ok(form.includes('Nombre completo: Ana') && form.includes('Cantidad: 3') && !form.includes('secreto'), 'Formularios campo por campo, sin el token');
const pedido = textoPedido({ text: 'Para el viernes', product_items: [{ product_retailer_id: 'RESMA-A4', quantity: 2, item_price: 45000, currency: 'PYG' }, { product_retailer_id: 'CARTON-N', quantity: 1, item_price: 12000, currency: 'PYG' }] });
assert.ok(pedido.includes('2 × RESMA-A4 — Gs 45.000') && pedido.includes('Total: Gs 102.000') && pedido.includes('Nota del cliente: Para el viernes'), 'Pedidos del catálogo completos');
const sis = contenidoCloud({ type: 'system', system: { type: 'customer_changed_number', new_wa_id: '595981222333' } });
assert.equal(sis.especial, 'sistema'); assert.ok(sis.texto.includes('+595981222333'));
const no = contenidoCloud({ type: 'unsupported', errors: [{ code: 131051, error_data: { details: 'Message type is currently not supported: poll' } }] });
assert.equal(no.especial, 'no_admitido'); assert.ok(no.texto.includes('una encuesta'));
assert.ok(contenidoCloud({ type: 'request_welcome' }).omitir, 'El inicio de conversación sin texto no genera un mensaje vacío');
assert.equal(contenidoCloud({ type: 'image', image: {} }), null, 'La multimedia sigue su camino de descarga');
for (const t of ['nuevo_tipo', 'ephemeral', 'edit']) assert.ok(!/\[\w+ recibido\]/.test(contenidoCloud({ type: t }).texto), 'Nunca un nombre técnico: ' + t);
assert.ok(textoAdjuntoFallido('document', { filename: 'cotizacion.pdf' }).includes('un documento: cotizacion.pdf'));
assert.ok(textoAdjuntoFallido('audio', { voice: true }).includes('una nota de voz'));
assert.ok(textoAnuncio({ source_type: 'ad', headline: 'Resmas en oferta', source_url: 'https://fb.me/x' }).includes('anuncio de Meta «Resmas en oferta»'));

// --- Línea normal (WhatsApp por QR) ---
assert.deepEqual(contenidoBaileys({ reactionMessage: { text: '❤️', key: { id: 'M1' } } }), { texto: 'Reaccionó con ❤️', especial: 'reaccion', citaExt: 'M1' });
const enc = contenidoBaileys({ pollCreationMessageV3: { name: '¿Qué color?', options: [{ optionName: 'Negro' }, { optionName: 'Blanco' }] } });
assert.ok(enc.texto.includes('Encuesta: ¿Qué color?') && enc.texto.includes('• Negro'), 'Encuestas con sus opciones');
assert.ok(contenidoBaileys({ productMessage: { product: { title: 'Cartón dúplex', priceAmount1000: 15000000, currencyCode: 'PYG' } } }).texto.includes('Gs 15.000'));
assert.ok(contenidoBaileys({ pollUpdateMessage: {} }).omitir);
assert.equal(contenidoBaileys({ conversation: 'hola' }), null);

// --- Messenger / Instagram ---
assert.ok(textoAdjuntoMeta([{ type: 'fallback', payload: { title: 'Catálogo', url: 'https://impar.com.py' } }]).includes('Catálogo · https://impar.com.py'));
assert.ok(textoAdjuntoMeta([{ type: 'story_mention', payload: { url: 'https://cdn/x' } }]).includes('Te mencionó en su historia'));

// --- Recepción: los tres canales usan el mismo criterio ---
const meta = leer('src/channels/meta.mjs'), baileys = leer('src/channels/baileys.mjs');
assert.ok(!meta.includes('recibido]`') && !meta.includes("recibido]'"), 'La línea verificada ya no arma «[tipo recibido]»');
assert.ok(meta.includes('const simple = contenidoCloud(m);') && meta.includes('ev.reaction?.mid') && meta.includes('ev.message.reply_to?.mid') && meta.includes('ev.postback'), 'Messenger/Instagram: reacciones, citas y botones');
assert.ok(baileys.includes("sock.ev.on('call'") && baileys.includes('async function marcarEliminado(') && baileys.includes('const especialWA=contenidoBaileys(contenido);'), 'Línea normal: llamadas, eliminados y especiales');
assert.ok(leer('src/worker.mjs').includes('especial: m.payload?.especial || null'), 'El worker pasa la marca');

// --- Ingesta: una reacción no mueve la negociación; una llamada sí ---
const core = leer('src/core.mjs');
const ingesta = core.slice(core.indexOf('export async function ingresarMensaje'), core.indexOf('\nasync function guardarUbicacion')).replace('export ', '');
async function ingresar(especial, abierta = { id: 'n1', etapa: 'contactado', agente_id: 'a1', canal_id: 'c1' }) {
  const consultas = [], avisos = [];
  const contacto = { id: 'k1', nombre: 'Sam C.', tel: '595972294599', externos: { whatsapp: '595972294599' } };
  const q = async (sql, p) => { consultas.push({ sql, p }); return { rows: [], rowCount: 1 }; };
  const fn = vm.runInNewContext(ingesta + ';ingresarMensaje', { q, Date, JSON, console,
    buscarContacto: async () => contacto, negActivaDeContacto: async () => abierta,
    resolverCitaEntrante: async (_q, _e, c) => ({ ...c, id: 9, txt: 'Para la próxima semana', dir: 'out' }),
    historial: async () => {}, notificar: async (...a) => avisos.push(a), emitir: () => {}, pulsoSala: () => {}, programarBot: () => avisos.push('bot'),
    leerEnlace: async (_q, _e, t) => ({ texto: t, agente: null }), guardarUbicacion: async () => {} });
  const res = await fn({ id: 'impar', codigo: 'impar', flags: { antiDuplicado: true, bot: true }, bot: { activo: true } },
    { origen: 'whatsapp', canalId: 'c1', remitente: contacto.tel, texto: 'Reaccionó con 👍', extId: 'wamid.R', especial, cita: { ext: 'wamid.X', txt: '', dir: 'in' } });
  return { consultas, avisos, res };
}
const reac = await ingresar('reaccion');
assert.ok(!reac.consultas.some(c => /etapa='espera'/.test(c.sql)), 'La reacción no pasa a «Cliente espera respuesta»');
assert.equal(reac.avisos.length, 0, 'Ni avisa al agente ni despierta al bot');
const ins = reac.consultas.find(c => c.sql.includes('INSERT INTO mensajes'));
assert.equal(ins.p.at(-1), 'reaccion'); assert.equal(JSON.parse(ins.p[6]).txt, 'Para la próxima semana', 'Cita el mensaje al que reaccionó');
assert.ok(reac.res.informativo);
const llamada = await ingresar('llamada');
assert.ok(llamada.consultas.some(c => /etapa='espera'/.test(c.sql)), 'Una llamada perdida sí deja al cliente esperando');
const truco = await ingresar('cualquier_cosa');
assert.ok(truco.consultas.some(c => /etapa='espera'/.test(c.sql)) && truco.consultas.find(c => c.sql.includes('INSERT INTO mensajes')).p.at(-1) === null, 'Una marca desconocida se ignora');

// --- Datos y estadísticas ---
const mig = leer('src/migrations/036_mensajes_especiales_impar.sql');
assert.ok(mig.includes("ADD COLUMN IF NOT EXISTS especial TEXT") && mig.includes("WHERE dir='in' AND txt='[reaction recibido]'"), 'Columna nueva y corrección de lo ya guardado');
assert.ok(leer('src/tiempos-respuesta-impar.mjs').includes("COALESCE(m.especial,'') NOT IN ('reaccion','sistema','plantilla')"), 'Las reacciones no cuentan en los tiempos de respuesta');
assert.ok(leer('public/js/ficha.js').includes("m.especial === 'reaccion' || m.especial === 'sistema'") && leer('public/js/ficha.js').includes('El cliente eliminó este mensaje'), 'Se ven en la conversación');

// --- Plantillas de campañas en la conversación ---
const { textoPlantilla } = await import('../src/campanas-impar.mjs');
const tp = textoPlantilla({ nombrado: false, encabezado: { formato: 'IMAGE', texto: '', variables: [] }, cuerpo: { texto: 'Hola {{1}}, volvió el cartón dúplex', variables: ['1'] },
  pie: 'IMPAR Papeles', botones: [{ tipo: 'QUICK_REPLY', texto: 'Quiero' }] }, { cuerpo: { 1: { fuente: 'nombre' } } }, { nombre: 'Sam' });
assert.equal(tp, '🖼️ Imagen\n\nHola Sam, volvió el cartón dúplex\n\nIMPAR Papeles\n\n🔘 Quiero', 'La plantilla como la ve el cliente');
const camp = leer('src/campanas-impar.mjs');
assert.ok(camp.includes("VALUES ($1,$2,'out',$3,$4,$5,$6,'plantilla','ok') ON CONFLICT DO NOTHING") && camp.includes('ts: d.enviado, canalId: d.canal_id, negociacionId'), 'Se guarda en el chat al enviar y al responder el cliente');
assert.ok(leer('src/citas-impar.mjs').includes('FROM campana_destinos d'), 'La respuesta citada muestra la plantilla');
assert.ok(leer('public/js/ficha.js').includes('Plantilla de WhatsApp · campaña'));
assert.ok(leer('src/migrations/038_plantillas_en_chat_impar.sql').includes("'plantilla'"));

console.log('✔ IMPAR: reacciones, pedidos, formularios, encuestas, llamadas, eliminados y avisos de WhatsApp visibles sin mover la negociación.');
