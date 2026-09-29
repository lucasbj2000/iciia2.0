/**
 * Carga manual simplificada: nombre, teléfono y mensajes del cliente.
 * Si el cliente ya existe se usa ese contacto; si tiene una negociación abierta,
 * los mensajes se agregan al final de su conversación.
 */
import { Router } from 'express';
import { q, telNorm } from '../db.mjs';
import { requiere } from '../auth.mjs';
import { notificar, auditar, historial, asignarEquitativo, negActivaDeContacto, crearContacto, nombreEtapa } from '../core.mjs';
import { emitir } from '../realtime.mjs';

const r = Router();
const ABIERTAS = "('nuevo','contactado','espera')";

/** Horarios de los mensajes: siempre después del último de la conversación y en el orden cargado. */
export function calcularTiempos(ultimo, mensajes, ahora = Date.now()) {
  let piso = ultimo ? new Date(ultimo).getTime() : 0;
  return mensajes.map((m, i) => {
    let t = m.fecha ? new Date(m.fecha).getTime() : NaN;
    if (!Number.isFinite(t)) t = ahora - (mensajes.length - 1 - i) * 1000;
    if (t <= piso) t = piso + 1000;
    piso = t;
    return new Date(t);
  });
}

r.get('/buscar', requiere('admin'), async (req, res) => {
  const txt = String(req.query.q || '').trim();
  const dig = telNorm(txt);
  const porTel = dig.length >= 6 && /^[\d\s+()-]+$/.test(txt);
  if (!porTel && txt.length < 3) return res.json([]);
  const { rows } = await q(
    `SELECT c.id, c.nombre, c.tel, c.tel_norm, c.email, u.nombre AS responsable,
            n.id AS neg_id, n.etapa AS neg_etapa,
            (SELECT COUNT(*)::int FROM mensajes m WHERE m.negociacion_id=n.id) AS neg_mensajes
       FROM contactos c
       LEFT JOIN usuarios u ON u.id=c.responsable_id
       LEFT JOIN LATERAL (SELECT id, etapa FROM negociaciones x
                           WHERE x.contacto_id=c.id AND x.etapa IN ${ABIERTAS} ORDER BY x.creado LIMIT 1) n ON TRUE
      WHERE c.empresa_id=$1 AND ${porTel ? "c.tel_norm LIKE '%'||$2||'%'" : "lower(c.nombre) LIKE '%'||$2||'%'"}
      ORDER BY (c.tel_norm=$3) DESC, c.creado DESC LIMIT 6`,
    [req.empresaId, porTel ? dig : txt.toLowerCase(), dig]);
  res.json(rows.map(x => ({ ...x, exacto: porTel && x.tel_norm === dig,
    etapaNombre: x.neg_etapa ? nombreEtapa(req.empresa, x.neg_etapa) : null })));
});

r.post('/cargar', requiere('admin'), async (req, res) => {
  const emp = req.empresa, b = req.body || {};
  if (emp.flags?.cargaManual === false) return res.status(403).json({ error: 'La carga manual está desactivada.' });

  const mensajes = (Array.isArray(b.mensajes) ? b.mensajes : [])
    .map(m => ({ txt: String(m?.txt || '').trim().slice(0, 4000), fecha: m?.fecha || null }))
    .filter(m => m.txt);
  if (!mensajes.length) return res.status(422).json({ error: 'Agregá al menos un mensaje del cliente.' });
  if (mensajes.length > 100) return res.status(422).json({ error: 'Máximo 100 mensajes por carga.' });

  /* --- contacto: el elegido, el que tenga ese teléfono, o uno nuevo --- */
  let contacto = null, contactoNuevo = false;
  const tel = String(b.tel || '').trim();
  if (b.contactoId) {
    const { rows } = await q('SELECT * FROM contactos WHERE id=$1 AND empresa_id=$2', [b.contactoId, req.empresaId]);
    contacto = rows[0];
    if (!contacto) return res.status(404).json({ error: 'El cliente elegido no existe.' });
  }
  if (!contacto && telNorm(tel)) {
    const { rows } = await q('SELECT * FROM contactos WHERE empresa_id=$1 AND tel_norm=$2 LIMIT 1', [req.empresaId, telNorm(tel)]);
    contacto = rows[0] || null;
  }
  if (!contacto) {
    const nombre = String(b.nombre || '').trim();
    if (!nombre) return res.status(422).json({ error: 'Ingresá el nombre del cliente.' });
    if (!telNorm(tel)) return res.status(422).json({ error: 'Ingresá el teléfono del cliente.' });
    contacto = await crearContacto(emp, { nombre, tel, externos: { whatsapp: tel.replace(/\D/g, '') } });
    contactoNuevo = true;
  } else if (b.nombre && /^(WhatsApp|Messenger|Instagram|Contacto) /.test(contacto.nombre)) {
    await q('UPDATE contactos SET nombre=$3 WHERE id=$1 AND empresa_id=$2', [contacto.id, req.empresaId, String(b.nombre).trim()]);
    contacto.nombre = String(b.nombre).trim();
  }

  /* --- negociación: la abierta, o una nueva --- */
  let neg = await negActivaDeContacto(emp, contacto.id);
  const reusada = !!neg;
  if (!neg) {
    let agente = contacto.responsable_id || await asignarEquitativo(emp, { sucursal: contacto.sucursal });
    const { rows: cs } = await q(
      `SELECT id FROM canales WHERE empresa_id=$1 AND activo
        ORDER BY (tipo LIKE 'whatsapp%') DESC, (estado='conectado') DESC, creado LIMIT 1`, [req.empresaId]);
    const { rows } = await q(
      `INSERT INTO negociaciones (empresa_id,contacto_id,titulo,etapa,origen,canal_id,agente_id,sucursal,linea,marcadores,bot_activo)
       VALUES ($1,$2,'Carga manual','espera','whatsapp',$3,$4,$5,$6,'["manual"]'::jsonb,FALSE) RETURNING *`,
      [req.empresaId, contacto.id, cs[0]?.id || null, agente, contacto.sucursal, contacto.linea]);
    neg = rows[0];
    if (!contacto.responsable_id && agente)
      await q('UPDATE contactos SET responsable_id=$3 WHERE id=$1 AND empresa_id=$2', [contacto.id, req.empresaId, agente]);
  }

  /* --- mensajes, a continuación de los existentes --- */
  const { rows: ult } = await q('SELECT MAX(ts) AS t FROM mensajes WHERE negociacion_id=$1', [neg.id]);
  const tiempos = calcularTiempos(ult[0]?.t, mensajes);
  for (let i = 0; i < mensajes.length; i++) {
    await q(`INSERT INTO mensajes (empresa_id,negociacion_id,dir,txt,ts) VALUES ($1,$2,'in',$3,$4)`,
      [req.empresaId, neg.id, mensajes[i].txt, tiempos[i]]);
  }
  await q(
    `UPDATE negociaciones SET actualizado=now(),
       marcadores = CASE WHEN marcadores @> '["manual"]'::jsonb THEN marcadores ELSE marcadores || '["manual"]'::jsonb END,
       etapa = CASE WHEN etapa='contactado' THEN 'espera' ELSE etapa END,
       entrada_etapa = CASE WHEN etapa='contactado' THEN now() ELSE entrada_etapa END,
       aviso_sla = CASE WHEN etapa='contactado' THEN FALSE ELSE aviso_sla END
     WHERE id=$1 AND empresa_id=$2`, [neg.id, req.empresaId]);

  await historial(req.empresaId, neg.id,
    `✎ El administrador cargó ${mensajes.length} mensaje(s) del cliente${reusada ? ' en la conversación existente' : ''}`, req.user.nombre);
  await notificar(emp, 'manual', { cliente: contacto.nombre }, [neg.agente_id], neg.id);
  await auditar(req.empresaId, req.user.nombre, 'Carga manual', `${contacto.nombre} · ${mensajes.length} mensaje(s)`, req.ip);
  emitir(req.empresaId, reusada ? 'neg:patch' : 'neg:nueva', { id: neg.id });
  res.json({ ok: true, negociacionId: neg.id, reusada, contactoNuevo, cliente: contacto.nombre, mensajes: mensajes.length });
});

export default r;
