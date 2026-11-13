/** IMPAR · Rutas que usa la pasarela telefónica (no los usuarios): se autentica con su propio token. */
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { pasarelaPorToken, conectarPasarela, eventoPasarela } from '../pasarela-tel-impar.mjs';

const r = Router();
r.use(rateLimit({ windowMs: 60 * 1000, max: 240, standardHeaders: true, legacyHeaders: false, message: { error: 'Demasiadas solicitudes de la pasarela.' } }));
async function autenticar(req, res, next) {
  const m = /^Bearer\s+(\S+)$/.exec(String(req.headers.authorization || ''));
  const p = m ? await pasarelaPorToken(m[1]).catch(() => null) : null;
  if (!p) return res.status(401).json({ error: 'Token de pasarela inválido.' });
  req.pasarela = p; next();
}
r.get('/eventos', autenticar, (req, res) => conectarPasarela(req.pasarela, req, res));
r.post('/evento', autenticar, async (req, res) => {
  try { res.json(await eventoPasarela(req.pasarela, req.body || {})); }
  catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    console.warn('[pasarela] Evento:', e.message);
    res.status(500).json({ error: 'No se pudo procesar el evento.' });
  }
});
export default r;
