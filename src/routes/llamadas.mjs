/** IMPAR · Llamadas de WhatsApp en prueba: solo administradores y, una vez activadas, solo los probadores. */
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { q } from '../db.mjs';
import { requiere } from '../auth.mjs';
import { auditar } from '../core.mjs';
import {
  configLlamadas, esProbador, puedeConfigurar, canalesCloud, canalLlamadas, estadoMeta, activarEnMeta, desactivarEnMeta,
  permiso, pedirPermiso, enviarBotonLlamada, iniciarLlamada, atenderLlamada, rechazarLlamada, cortarLlamada, historial
} from '../llamadas-wa-impar.mjs';

const r = Router();
r.use(requiere('admin'));
const limite = rateLimit({ windowMs: 60 * 1000, max: 40, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Demasiadas acciones de llamada seguidas. Esperá un minuto.' } });
r.use(limite);

const enviar = fn => async (req, res, next) => { try { res.json(await fn(req)); } catch (e) { if (e.status) return res.status(e.status).json({ error: e.message }); next(e); } };
const noVisible = () => Object.assign(new Error('No disponible.'), { status: 404 });
async function soloProbador(req) {
  const cfg = await configLlamadas(req.empresaId);
  if (!puedeConfigurar(cfg, req.user)) throw noVisible();
  return cfg;
}
const callId = v => { const s = String(v || ''); if (!/^[\w.\-:=]{6,200}$/.test(s)) throw Object.assign(new Error('Llamada inválida.'), { status: 422 }); return s; };

/** Qué ve este usuario. Para cualquier administrador que no sea probador responde «no visible». */
r.get('/estado', enviar(async req => {
  const cfg = await configLlamadas(req.empresaId);
  if (!puedeConfigurar(cfg, req.user)) return { visible: false };
  const canales = await canalesCloud(req.empresaId);
  let meta = null, canal = null;
  if (canales.length) {
    try { canal = await canalLlamadas(req.empresaId, cfg); meta = await estadoMeta(canal); }
    catch (e) { meta = { error: e.message }; }
  }
  return { visible: true, activo: !!cfg.activo, probador: esProbador(cfg, req.user),
    canales, canal_id: canal?.id || null, meta, mio: req.user.id };
}));

r.post('/activar', enviar(async req => {
  const cfg = await soloProbador(req);
  const canal = await canalLlamadas(req.empresaId, { ...cfg, canal_id: req.body?.canal_id || cfg.canal_id });
  await activarEnMeta(canal);
  const probadores = (cfg.probadores || []).length ? cfg.probadores : [req.user.id];
  await q(`INSERT INTO llamadas_wa_config_impar(empresa_id,activo,probadores,canal_id,actualizado) VALUES($1,true,$2,$3,now())
           ON CONFLICT(empresa_id) DO UPDATE SET activo=true,probadores=$2,canal_id=$3,actualizado=now()`, [req.empresaId, probadores, canal.id]);
  auditar(req.empresaId, req.user.usuario, 'llamadas:activar', 'Llamadas de WhatsApp activadas en prueba (ícono oculto)', req.ip).catch(() => {});
  return { ok: true };
}));

r.post('/desactivar', enviar(async req => {
  const cfg = await soloProbador(req);
  try { const canal = await canalLlamadas(req.empresaId, cfg); await desactivarEnMeta(canal); }
  catch (e) { if (e.status !== 409) throw e; }
  await q('UPDATE llamadas_wa_config_impar SET activo=false,actualizado=now() WHERE empresa_id=$1', [req.empresaId]);
  auditar(req.empresaId, req.user.usuario, 'llamadas:desactivar', 'Llamadas de WhatsApp desactivadas', req.ip).catch(() => {});
  return { ok: true };
}));

r.get('/permiso', enviar(async req => {
  const cfg = await soloProbador(req);
  return permiso(await canalLlamadas(req.empresaId, cfg), req.query.tel);
}));
r.post('/permiso', enviar(async req => {
  const cfg = await soloProbador(req); if (!cfg.activo) throw Object.assign(new Error('Activá primero las llamadas.'), { status: 409 });
  await pedirPermiso(await canalLlamadas(req.empresaId, cfg), req.body?.tel);
  return { ok: true };
}));
r.post('/boton-prueba', enviar(async req => {
  const cfg = await soloProbador(req); if (!cfg.activo) throw Object.assign(new Error('Activá primero las llamadas.'), { status: 409 });
  await enviarBotonLlamada(await canalLlamadas(req.empresaId, cfg), req.body?.tel);
  return { ok: true };
}));

r.post('/iniciar', enviar(async req => { await soloProbador(req); return iniciarLlamada(req.empresaId, req.user, req.body || {}); }));
r.post('/:id/atender', enviar(async req => { await soloProbador(req); return atenderLlamada(req.empresaId, req.user, callId(req.params.id), req.body?.sdp); }));
r.post('/:id/rechazar', enviar(async req => { await soloProbador(req); return rechazarLlamada(req.empresaId, req.user, callId(req.params.id)); }));
r.post('/:id/cortar', enviar(async req => { await soloProbador(req); return cortarLlamada(req.empresaId, req.user, callId(req.params.id)); }));
r.get('/historial', enviar(async req => { await soloProbador(req); return historial(req.empresaId); }));

export default r;
