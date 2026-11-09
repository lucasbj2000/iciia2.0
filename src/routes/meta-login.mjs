/* IMPAR · rutas de «Conectar con Facebook» (Messenger e Instagram). */
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { q } from '../db.mjs';
import { requiere } from '../auth.mjs';
import { auditar } from '../core.mjs';
import { emitir } from '../realtime.mjs';
import { APP_ID, urlRetorno, leerAjustes, guardarAjustes, iniciar, completar, verEstado, conectar } from '../meta-login-impar.mjs';

const r = Router();
const base = req => (process.env.PUBLIC_URL || `https://${req.get('host')}`).replace(/\/+$/, '');
const safe = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/* Retorno desde Facebook: sin sesión del CRM (es otra ventana); lo protege el «state» de un solo uso. */
const limiteRetorno = rateLimit({ windowMs: 10 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false });
r.get('/retorno', limiteRetorno, safe(async (req, res) => {
  const resultado = await completar({
    state: req.query.state, code: req.query.code, error: req.query.error || req.query.error_reason, base: base(req)
  });
  res.set('Cache-Control', 'no-store').set('Referrer-Policy', 'no-referrer').type('html').send(`<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Conectar con Facebook · IMPAR</title>
<style>body{font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#f4f6f3;color:#1d2a1f}
main{max-width:420px;padding:28px;text-align:center}h1{font-size:20px;margin:0 0 8px}p{color:#4b5a4e;line-height:1.5}
.ok{color:#17663A}.mal{color:#a12b2b}button{margin-top:12px;padding:10px 16px;border-radius:10px;border:1px solid #c9d3cb;background:#fff;font:inherit;cursor:pointer}</style></head>
<body><main id="meta-retorno" data-estado="${resultado.ok ? 'listo' : 'error'}" data-state="${esc(/^[0-9a-f]{64}$/.test(String(req.query.state || '')) ? req.query.state : '')}">
<h1 class="${resultado.ok ? 'ok' : 'mal'}">${resultado.ok ? 'Facebook conectado' : 'No se pudo conectar'}</h1>
<p>${esc(resultado.mensaje)}</p><button type="button" id="cerrar">Cerrar esta ventana</button></main>
<script src="/js/meta-login-retorno.js"></script></body></html>`);
}));

r.use(requiere('admin'));

r.get('/ajustes', safe(async (req, res) => {
  const a = await leerAjustes(req.empresaId);
  res.json({ ...a, appId: APP_ID, redirect: urlRetorno(base(req)), tieneSecret: !!process.env.META_APP_SECRET, https: base(req).startsWith('https://') });
}));

r.put('/ajustes', safe(async (req, res) => {
  const configId = String(req.body?.configId || '').trim();
  if (configId && !/^\d{5,25}$/.test(configId)) return res.status(422).json({ error: 'El ID de configuración son solo números (lo copiás de Meta).' });
  await guardarAjustes(req.empresaId, configId);
  await auditar(req.empresaId, req.user.nombre, 'Canal', 'Configuración de «Conectar con Facebook»', req.ip);
  res.json({ ok: true, configId });
}));

r.post('/iniciar', safe(async (req, res) => {
  const { configId } = await leerAjustes(req.empresaId);
  if (!configId) return res.status(409).json({ error: 'Falta el ID de configuración de Meta. Cargalo en este mismo recuadro.' });
  if (!process.env.META_APP_SECRET) return res.status(503).json({ error: 'Falta META_APP_SECRET en el servidor.' });
  res.json(await iniciar({ empresaId: req.empresaId, usuarioId: req.user.id, configId, base: base(req) }));
}));

r.get('/estado/:state', safe(async (req, res) => {
  if (!/^[0-9a-f]{64}$/.test(req.params.state)) return res.status(404).json({ error: 'no encontrado' });
  const e = await verEstado(req.params.state, req.empresaId, req.user.id);
  if (!e) return res.status(404).json({ error: 'no encontrado' });
  res.json(e);
}));

r.post('/conectar', safe(async (req, res) => {
  const b = req.body || {};
  if (!/^[0-9a-f]{64}$/.test(String(b.state || ''))) return res.status(422).json({ error: 'Inicio de sesión inválido.' });
  if (b.sucursalId) {
    const { rows } = await q('SELECT 1 FROM sucursales WHERE id=$1 AND empresa_id=$2', [b.sucursalId, req.empresaId]);
    if (!rows.length) return res.status(404).json({ error: 'La sucursal no pertenece a esta empresa.' });
  }
  try {
    const r2 = await conectar({ state: b.state, empresaId: req.empresaId, usuarioId: req.user.id, pageId: b.pageId,
      messenger: b.messenger === true, instagram: b.instagram === true, sucursalId: b.sucursalId || null });
    await auditar(req.empresaId, req.user.nombre, 'Canal', `Conectar con Facebook · ${r2.pagina.page_nombre} · ${r2.canales.map(c => c.tipo).join(' + ')}`, req.ip);
    emitir(req.empresaId, 'canales:cambio', {});
    res.json({ ok: true, ...r2 });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    throw e;
  }
}));

export default r;
