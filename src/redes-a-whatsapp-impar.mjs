/** IMPAR · de Messenger/Instagram a WhatsApp, siempre en la misma ficha y negociación.
 *
 * Cuando el cliente de redes pasa su número (lo escribe en el chat o el agente lo
 * carga con «Pasar a WhatsApp»):
 *  - si ese número ya es de otro cliente, las dos fichas quedan en una (la del número),
 *    con sus datos de redes guardados;
 *  - si no, la ficha de redes recibe el número;
 *  - la negociación abierta pasa a responder por la línea de WhatsApp y sigue ahí,
 *    aunque el cliente vuelva a escribir por redes.
 */
import { q, tx, telNorm } from './db.mjs';
import { emitir } from './realtime.mjs';
import { normalizarNumero } from './telefonos-impar.mjs';
import { rutaDeEnvio } from './ventana-24h-impar.mjs';
import { fusionarContactos, ETAPAS_ABIERTAS } from './duplicados-impar.mjs';

const REDES = { messenger: 'Messenger', instagram: 'Instagram' };

/** Celular paraguayo escrito en un mensaje (0981 123 456, +595 981-123-456, 595981123456…).
 * Devuelve el número solo si hay uno; con dos números distintos no adivina. */
export function extraerCelular(texto) {
  const encontrados = new Set();
  const re = /(?<![\d])(?:\+?\s?595[\s.-]?|0)?9[6-9]\d(?:[\s.-]?\d){6}(?![\d])/g;
  for (const m of String(texto || '').matchAll(re)) {
    const d = m[0].replace(/\D/g, '');
    const local = d.startsWith('595') ? d.slice(3) : d.startsWith('0') ? d.slice(1) : d;
    if (/^9[6-9]\d{7}$/.test(local)) encontrados.add('595' + local);
  }
  return encontrados.size === 1 ? [...encontrados][0] : null;
}

const fallo = (status, mensaje) => { throw Object.assign(new Error(mensaje), { status }); };

/** Pasa la negociación abierta a WhatsApp con ese número. Devuelve la negociación que queda. */
export async function pasarAWhatsApp(empresa, { negociacionId, numero, por = 'Sistema', automatico = false, sucursal = '' }) {
  const { numero: tel, clave } = normalizarNumero(numero);
  const r = await tx(async db => {
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [empresa.id + ':' + clave]);
    const { rows: [n] } = await db.query(
      `SELECT n.*, ca.tipo AS canal_tipo FROM negociaciones n LEFT JOIN canales ca ON ca.id=n.canal_id
        WHERE n.id=$1 AND n.empresa_id=$2 FOR UPDATE OF n`, [negociacionId, empresa.id]);
    if (!n) fallo(404, 'Negociación no encontrada.');
    if (!ETAPAS_ABIERTAS.includes(n.etapa)) fallo(409, 'La negociación está cerrada. Abrí una nueva para escribirle por WhatsApp.');
    const { rows: [c] } = await db.query('SELECT * FROM contactos WHERE id=$1 AND empresa_id=$2 FOR UPDATE', [n.contacto_id, empresa.id]);
    const red = REDES[n.origen] || (c.externos?.instagram ? 'Instagram' : c.externos?.messenger ? 'Messenger' : 'redes');

    // ¿El número ya es de otro cliente?
    const { rows: otros } = await db.query(
      `SELECT DISTINCT c.id, c.creado FROM contactos c
         LEFT JOIN contacto_telefonos t ON t.contacto_id=c.id AND t.empresa_id=c.empresa_id
        WHERE c.empresa_id=$1 AND c.id<>$2 AND (c.tel_norm=$3 OR t.tel_norm=$3) ORDER BY c.creado LIMIT 1`,
      [empresa.id, c.id, clave]);
    let contactoId = c.id, negId = n.id, unificado = false;
    if (otros[0]) {
      const f = await fusionarContactos(db, empresa.id, otros[0].id, c.id,
        { motivo: `el cliente pasó su número por ${red}`, por });
      contactoId = otros[0].id; negId = f?.negociacionId || negId; unificado = true;
    } else if (!c.tel_norm) {
      await db.query('UPDATE contactos SET tel=$3 WHERE id=$1 AND empresa_id=$2', [c.id, empresa.id, tel]);
      await db.query(`INSERT INTO contacto_telefonos (empresa_id,contacto_id,numero,tel_norm,etiqueta)
                      VALUES ($1,$2,$3,$4,'Principal') ON CONFLICT (empresa_id,tel_norm) DO NOTHING`, [empresa.id, c.id, tel, clave]);
    } else if (c.tel_norm !== clave) {
      await db.query(`INSERT INTO contacto_telefonos (empresa_id,contacto_id,numero,tel_norm,etiqueta)
                      VALUES ($1,$2,$3,$4,'WhatsApp') ON CONFLICT (empresa_id,tel_norm) DO NOTHING`, [empresa.id, c.id, tel, clave]);
    }
    // La negociación que queda responde por WhatsApp a ese número.
    const ruta = await rutaDeEnvio({ empresaId: empresa.id, contactoId, canalId: null, sucursal: sucursal || n.sucursal || '' }, db);
    const { rows: [canal] } = await db.query('SELECT id,nombre,tipo FROM canales WHERE id=$1', [ruta.canalId]);
    if (!canal || !canal.tipo.startsWith('whatsapp')) fallo(409, 'No hay una línea de WhatsApp activa para continuar la conversación.');
    await db.query('UPDATE negociaciones SET canal_id=$3, telefono_destino=$4, actualizado=now() WHERE id=$1 AND empresa_id=$2',
      [negId, empresa.id, canal.id, tel]);
    const aviso = automatico
      ? `📱 El cliente compartió su número por ${red}: la conversación sigue por WhatsApp («${canal.nombre}»)`
      : `📱 Conversación pasada de ${red} a WhatsApp («${canal.nombre}»)`;
    await db.query('INSERT INTO historial (empresa_id,negociacion_id,txt,por) VALUES ($1,$2,$3,$4)', [empresa.id, negId, aviso, por]);
    // Aviso visible en el chat para el agente (no cuenta como mensaje del cliente).
    await db.query(`INSERT INTO mensajes (empresa_id,negociacion_id,dir,txt,especial) VALUES ($1,$2,'in',$3,'sistema')`,
      [empresa.id, negId, `ℹ️ ${aviso.replace(/^📱 /, '')}. Número: +${tel}`]);
    return { negociacionId: negId, contactoId, canal: canal.nombre, numero: tel, unificado };
  });
  emitir(empresa.id, r.unificado ? 'neg:recargar' : 'neg:patch', r.unificado ? {} : { id: r.negociacionId });
  return r;
}

/** Mensaje entrante por redes: si trae el número del cliente y la ficha todavía no
 * sigue por WhatsApp, se vincula automáticamente. */
export async function detectarNumeroEnRedes(empresa, { origen, texto, negociacionId }) {
  if (!REDES[origen] || !negociacionId) return null;
  const numero = extraerCelular(texto);
  if (!numero) return null;
  const { rows: [n] } = await q(
    `SELECT n.etapa, ca.tipo AS canal_tipo, n.telefono_destino, c.tel_norm
       FROM negociaciones n JOIN contactos c ON c.id=n.contacto_id LEFT JOIN canales ca ON ca.id=n.canal_id
      WHERE n.id=$1 AND n.empresa_id=$2`, [negociacionId, empresa.id]);
  if (!n || !ETAPAS_ABIERTAS.includes(n.etapa)) return null;
  // Ya sigue por WhatsApp con ese mismo número: nada que hacer.
  if (String(n.canal_tipo || '').startsWith('whatsapp') && telNorm(n.telefono_destino || '') === telNorm(numero)) return null;
  return pasarAWhatsApp(empresa, { negociacionId, numero, automatico: true });
}
