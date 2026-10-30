/** IMPAR · Enlaces de WhatsApp por agente. */
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { q } from '../db.mjs';
import { requiere } from '../auth.mjs';
import { NUMERO_ENLACE, slugDeUsuario, slugValido, enlaceWhatsApp, enlacePublico, textoPrecargado } from '../enlaces-agentes-impar.mjs';

const r = Router();
const base = req => (process.env.PUBLIC_URL || `https://${req.get('host')}`).replace(/\/+$/, '');
const ficha = (req, u) => ({
  usuarioId: u.id, nombre: u.nombre, usuario: u.usuario, rol: u.rol, sucursal: u.sucursal, activo: u.activo,
  enlace: enlacePublico(base(req), u), whatsapp: enlaceWhatsApp(u),
  mensaje: textoPrecargado(u).replace(/[​-‍]/g, ''), numero: NUMERO_ENLACE,
  clics30: Number(u.clics30 || 0), negociaciones30: Number(u.negociaciones30 || 0)
});
const METRICAS = `,(SELECT COUNT(*) FROM enlaces_clics_impar c WHERE c.usuario_id=u.id AND c.ts>now()-interval '30 days') AS clics30,
  (SELECT COUNT(*) FROM negociaciones n WHERE n.enlace_agente_id=u.id AND n.empresa_id=u.empresa_id AND n.creado>now()-interval '30 days') AS negociaciones30`;

/** Enlace propio de cualquier usuario autenticado. */
r.get('/mio', requiere(), async (req, res) => {
  const { rows } = await q(`SELECT u.* ${METRICAS} FROM usuarios u WHERE u.id=$1 AND u.empresa_id=$2`, [req.user.id, req.empresaId]);
  if (!rows[0] || !slugValido(slugDeUsuario(rows[0].usuario)))
    return res.status(422).json({ error: 'Tu usuario no admite enlace de WhatsApp.' });
  res.json(ficha(req, rows[0]));
});

/** Todos los enlaces (admin). */
r.get('/', requiere('admin'), async (req, res) => {
  const { rows } = await q(`SELECT u.* ${METRICAS} FROM usuarios u WHERE u.empresa_id=$1 AND u.activo ORDER BY lower(u.nombre)`, [req.empresaId]);
  res.json(rows.filter(u => slugValido(slugDeUsuario(u.usuario))).map(u => ficha(req, u)));
});
export default r;

/** Público: /w/:usuario → registra el clic y abre WhatsApp con el saludo del agente. */
export const limiteEnlaces = rateLimit({ windowMs: 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false });
export async function redirigirEnlace(req, res) {
  res.set('Cache-Control', 'no-store');
  res.set('Referrer-Policy', 'no-referrer');
  const generico = `https://wa.me/${NUMERO_ENLACE}`;
  const slug = String(req.params.usuario || '').toLowerCase();
  if (!slugValido(slug)) return res.redirect(302, generico);
  try {
    const { rows } = await q(
      `SELECT u.id,u.nombre,u.usuario,u.empresa_id FROM usuarios u JOIN empresas e ON e.id=u.empresa_id
        WHERE e.codigo='impar' AND e.activa AND u.activo AND (lower(u.usuario)=$1 OR lower(u.usuario)='impar.'||$1) LIMIT 1`, [slug]);
    const u = rows[0];
    if (!u) return res.redirect(302, generico);
    q('INSERT INTO enlaces_clics_impar(empresa_id,usuario_id) VALUES($1,$2)', [u.empresa_id, u.id])
      .catch(e => console.warn('[enlaces] Clic no registrado:', e.name));
    res.redirect(302, enlaceWhatsApp(u));
  } catch (e) {
    console.warn('[enlaces] Redirección sin agente:', e.name);
    res.redirect(302, generico);
  }
}
