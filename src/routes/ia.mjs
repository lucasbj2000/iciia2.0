/** Configuración de OpenAI y del bot por línea (solo administrador). */
import { Router } from 'express';
import { q } from '../db.mjs';
import { requiere } from '../auth.mjs';
import { auditar } from '../core.mjs';
import { emitir } from '../realtime.mjs';
import { cifrar, leerConfigIA, consultarIA, sistemaPara } from '../bot.mjs';

const r = Router();
const mascara = k => k ? k.slice(0, 3) + '••••••••' + k.slice(-4) : '';

r.get('/config', requiere('admin'), async (req, res) => {
  const cfg = leerConfigIA(req.empresa);
  const { rows } = await q(
    `SELECT c.id, c.nombre, c.tipo, c.estado, c.activo, c.bot_activo, c.bot_instrucciones, s.nombre AS sucursal
       FROM canales c LEFT JOIN sucursales s ON s.id=c.sucursal_id
      WHERE c.empresa_id=$1 ORDER BY s.nombre NULLS FIRST, c.creado`, [req.empresaId]);
  res.json({
    tieneToken: !!cfg.apiKey, token: mascara(cfg.apiKey),
    tokenIlegible: !!req.empresa.ia?.apiKey && !cfg.apiKey,
    modelo: cfg.modelo, temperatura: cfg.temperatura, maxRespuestas: cfg.maxRespuestas,
    activo: !!(req.empresa.flags?.bot && req.empresa.bot?.activo),
    instrucciones: req.empresa.bot?.instrucciones || '',
    canales: rows
  });
});

r.put('/config', requiere('admin'), async (req, res) => {
  const b = req.body || {};
  const ia = { ...(req.empresa.ia || {}) };
  if (b.borrarToken) delete ia.apiKey;
  else if (b.apiKey && !String(b.apiKey).includes('•')) {
    const k = String(b.apiKey).trim();
    if (!/^sk-[\w-]{20,}$/.test(k)) return res.status(422).json({ error: 'El token de OpenAI empieza con «sk-». Revisá que lo hayas copiado completo.' });
    ia.apiKey = cifrar(k);
  }
  if (b.modelo !== undefined) ia.modelo = String(b.modelo).trim() || 'gpt-4o-mini';
  if (b.temperatura !== undefined) ia.temperatura = Math.min(1.5, Math.max(0, Number(b.temperatura) || 0));
  if (b.maxRespuestas !== undefined) ia.maxRespuestas = Math.min(100, Math.max(1, parseInt(b.maxRespuestas, 10) || 15));

  const bot = { ...(req.empresa.bot || {}) };
  const flags = { ...(req.empresa.flags || {}) };
  if (typeof b.activo === 'boolean') { bot.activo = b.activo; flags.bot = b.activo; }
  if (b.instrucciones !== undefined) bot.instrucciones = String(b.instrucciones).slice(0, 12000);

  await q('UPDATE empresas SET ia=$2, bot=$3, flags=$4 WHERE id=$1',
    [req.empresaId, JSON.stringify(ia), JSON.stringify(bot), JSON.stringify(flags)]);
  await auditar(req.empresaId, req.user.nombre, 'IA y bot',
    b.borrarToken ? 'Token de OpenAI eliminado' : (b.apiKey ? 'Token de OpenAI actualizado' : 'Configuración actualizada'), req.ip);
  emitir(req.empresaId, 'config', {});
  res.json({ ok: true });
});

r.put('/canales/:id', requiere('admin'), async (req, res) => {
  const b = req.body || {};
  const { rowCount } = await q(
    `UPDATE canales SET bot_activo=COALESCE($3,bot_activo), bot_instrucciones=COALESCE($4,bot_instrucciones)
      WHERE id=$1 AND empresa_id=$2`,
    [req.params.id, req.empresaId, typeof b.bot_activo === 'boolean' ? b.bot_activo : null,
     b.bot_instrucciones === undefined ? null : String(b.bot_instrucciones).slice(0, 12000)]);
  if (!rowCount) return res.status(404).json({ error: 'Línea no encontrada.' });
  await auditar(req.empresaId, req.user.nombre, 'IA y bot', 'Instrucciones de línea actualizadas', req.ip);
  res.json({ ok: true });
});

/** Prueba: simula un mensaje de cliente y devuelve lo que respondería el bot. */
r.post('/probar', requiere('admin'), async (req, res) => {
  const b = req.body || {};
  const cfg = leerConfigIA(req.empresa);
  const apiKey = (b.apiKey && !String(b.apiKey).includes('•')) ? String(b.apiKey).trim() : cfg.apiKey;
  if (!apiKey) return res.status(422).json({ error: 'Cargá primero el token de OpenAI.' });
  let canal = null;
  if (b.canalId) {
    const { rows } = await q('SELECT tipo, bot_instrucciones FROM canales WHERE id=$1 AND empresa_id=$2', [b.canalId, req.empresaId]);
    canal = rows[0] || null;
  }
  const inicio = Date.now();
  try {
    const respuesta = await consultarIA({
      ...cfg, apiKey, modelo: b.modelo || cfg.modelo,
      sistema: sistemaPara(req.empresa, { cliente: 'un cliente de prueba', canal_tipo: canal?.tipo || 'whatsapp_qr',
        bot_instrucciones: b.instrucciones ?? canal?.bot_instrucciones ?? '' }),
      mensajes: [{ role: 'user', content: String(b.mensaje || 'Hola, quisiera información.').slice(0, 2000) }]
    });
    res.json({ ok: true, respuesta, ms: Date.now() - inicio });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

export default r;
