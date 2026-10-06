/**
 * Bot con OpenAI. Responde a los clientes según las instrucciones de la línea
 * (canal) por la que escribieron; si la línea no tiene instrucciones propias,
 * usa las generales de la empresa. El token se guarda cifrado.
 */
import crypto from 'node:crypto';
import { q } from './db.mjs';
import { emitir } from './realtime.mjs';
import { responderRecepcionImpar } from './recepcion-impar.mjs';

/* ---------- Cifrado del token (AES-256-GCM con clave derivada de JWT_SECRET) ---------- */
const clave = () => crypto.createHash('sha256').update(String(process.env.JWT_SECRET || 'iciia')).digest();
export function cifrar(txt) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', clave(), iv);
  const enc = Buffer.concat([c.update(String(txt), 'utf8'), c.final()]);
  return 'v1:' + Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64');
}
export function descifrar(s) {
  if (!s) return '';
  if (!String(s).startsWith('v1:')) return String(s);
  try {
    const b = Buffer.from(String(s).slice(3), 'base64');
    const d = crypto.createDecipheriv('aes-256-gcm', clave(), b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
  } catch (e) { return ''; }   // si cambió JWT_SECRET hay que volver a cargar el token
}

export function leerConfigIA(emp) {
  const ia = emp?.ia || {};
  return {
    apiKey: descifrar(ia.apiKey),
    modelo: ia.modelo || 'gpt-4o-mini',
    temperatura: Number.isFinite(Number(ia.temperatura)) ? Number(ia.temperatura) : 0.4,
    maxRespuestas: Number(ia.maxRespuestas) || 15
  };
}

const CANAL = { whatsapp_qr: 'WhatsApp', whatsapp_api: 'WhatsApp', messenger: 'Facebook Messenger', instagram: 'Instagram' };

export function sistemaPara(emp, n) {
  const propias = String(n?.bot_instrucciones || '').trim();
  const instr = propias || String(emp?.bot?.instrucciones || '').trim() || 'Sos el asistente virtual de la empresa.';
  return `${instr}

---
Contexto: atendés por ${CANAL[n?.canal_tipo] || 'chat'} a ${n?.cliente || 'un cliente'} en nombre de ${emp?.nombre || 'la empresa'}.
Respondé en español, en tono cordial y breve, como un mensaje de chat (máximo 3 oraciones).
No inventes precios, stock, plazos ni datos que no estén en tus instrucciones: si no sabés algo, decí que un asesor lo va a contactar en breve.`;
}

function traducir(status, msg, modelo) {
  if (status === 401) return 'El token de OpenAI es inválido o fue revocado.';
  if (status === 429) return 'OpenAI rechazó el pedido: la cuenta no tiene saldo o alcanzó su límite de uso.';
  if (status === 404) return `El modelo «${modelo}» no existe o tu cuenta no tiene acceso a él.`;
  return msg || `OpenAI respondió con error ${status}.`;
}

export async function consultarIA({ apiKey, modelo, temperatura, sistema, mensajes, maxTokens = 400 }) {
  if (!apiKey) throw new Error('No hay token de OpenAI cargado.');
  const pedir = async conTemperatura => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 30000);
    try {
      const cuerpo = { model: modelo || 'gpt-4o-mini', max_completion_tokens: maxTokens,
        messages: [{ role: 'system', content: sistema }, ...mensajes] };
      if (conTemperatura) cuerpo.temperature = temperatura;
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST', signal: ctrl.signal,
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(cuerpo)
      });
      const j = await r.json().catch(() => ({}));
      return { r, j };
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('OpenAI tardó demasiado en responder.');
      throw new Error('No se pudo conectar con OpenAI: ' + e.message);
    } finally { clearTimeout(t); }
  };
  let { r, j } = await pedir(true);
  // Algunos modelos no aceptan temperatura: se reintenta sin ella
  if (!r.ok && r.status === 400 && /temperature/i.test(j.error?.message || '')) ({ r, j } = await pedir(false));
  if (!r.ok) throw new Error(traducir(r.status, j.error?.message, modelo));
  const txt = j.choices?.[0]?.message?.content?.trim();
  if (!txt) throw new Error('OpenAI no devolvió una respuesta.');
  return txt;
}

/* ---------- Respuesta automática ---------- */
const espera = new Map();
/** Espera 4 s de silencio del cliente y responde una sola vez a la ráfaga de mensajes. */
export function programarBot(empresa, negId) {
  clearTimeout(espera.get(negId));
  espera.set(negId, setTimeout(() => {
    espera.delete(negId);
    responderBot(empresa.id, negId).catch(e => console.error('[bot]', e.message));
  }, 4000));
}

const anotar = (empresaId, negId, txt) =>
  q(`INSERT INTO historial (empresa_id,negociacion_id,txt,por) VALUES ($1,$2,$3,'Bot')`, [empresaId, negId, txt]);

export async function responderBot(empresaId, negId) {
  const { rows: es } = await q('SELECT * FROM empresas WHERE id=$1 AND activa', [empresaId]);
  const emp = es[0];
  if (!emp || !emp.flags?.bot || !emp.bot?.activo) return;
  if(emp.codigo==='impar' && emp.bot?.recepcionImpar!==false) return responderRecepcionImpar(empresaId,negId);
  const cfg = leerConfigIA(emp);
  if (!cfg.apiKey) return;

  const { rows } = await q(
    `SELECT n.id, n.bot_activo, n.canal_id, n.etapa, c.nombre AS cliente, c.tel, c.externos,
            ca.tipo AS canal_tipo, ca.activo AS canal_activo, ca.bot_activo AS canal_bot, ca.bot_instrucciones
       FROM negociaciones n JOIN contactos c ON c.id=n.contacto_id
       LEFT JOIN canales ca ON ca.id=n.canal_id
      WHERE n.id=$1 AND n.empresa_id=$2`, [negId, empresaId]);
  const n = rows[0];
  if (!n || !n.bot_activo || n.canal_bot === false || ['ganado', 'cerrado'].includes(n.etapa)) return;

  const { rows: hist } = await q(
    `SELECT dir, txt FROM mensajes WHERE negociacion_id=$1 AND COALESCE(txt,'')<>'' ORDER BY ts DESC LIMIT 14`, [negId]);
  if (!hist.length || hist[0].dir !== 'in') return;          // el último mensaje tiene que ser del cliente
  const { rows: cnt } = await q('SELECT COUNT(*)::int AS n FROM mensajes WHERE negociacion_id=$1 AND bot', [negId]);
  if (cnt[0].n >= cfg.maxRespuestas) return;                  // tope de respuestas por conversación

  let texto;
  try {
    texto = await consultarIA({ ...cfg, sistema: sistemaPara(emp, n),
      mensajes: hist.reverse().map(m => ({ role: m.dir === 'in' ? 'user' : 'assistant', content: String(m.txt).slice(0, 2000) })) });
  } catch (e) { await anotar(empresaId, negId, `🤖 El bot no pudo responder: ${e.message}`); return; }

  // Si mientras esperaba a OpenAI respondió un agente, el bot no interviene
  const { rows: ya } = await q('SELECT bot_activo FROM negociaciones WHERE id=$1', [negId]);
  if (!ya[0]?.bot_activo) return;

  const esWA = String(n.canal_tipo || '').startsWith('whatsapp');
  const destino = (!n.canal_id || n.canal_activo === false) ? ''
    : esWA ? ((n.canal_tipo === 'whatsapp_qr' && n.externos?.wa_jid) || n.tel || n.externos?.whatsapp || '')
      : (n.externos?.[n.canal_tipo === 'messenger' ? 'messenger' : 'instagram'] || '');

  await q(`INSERT INTO mensajes (empresa_id,negociacion_id,dir,txt,bot,estado,ts) VALUES ($1,$2,'out',$3,TRUE,$4,now())`,
    [empresaId, negId, texto, destino ? 'pendiente' : 'error']);
  if (destino) {
    await q(`INSERT INTO outbox (empresa_id,canal_id,negociacion_id,destino,txt) VALUES ($1,$2,$3,$4,$5)`,
      [empresaId, n.canal_id, negId, destino, texto]);
  } else await anotar(empresaId, negId, '🤖 El bot generó una respuesta pero la conversación no tiene un canal activo para enviarla.');
  emitir(empresaId, 'neg:patch', { id: negId });
}

