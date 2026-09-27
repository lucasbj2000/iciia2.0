import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { q, migrar, seed } from './db.mjs';
import { login, requiere } from './auth.mjs';
import { sseHandler } from './realtime.mjs';
import { motorSLA, avisarCumples, auditar } from './core.mjs';
import { arrancarWorkers } from './worker.mjs';
import { MEDIA_DIR } from './archivos.mjs';
import * as baileys from './channels/baileys.mjs';
import * as meta from './channels/meta.mjs';

import rNegociaciones from './routes/negociaciones.mjs';
import rContactos from './routes/contactos.mjs';
import rAdmin from './routes/admin.mjs';
import rCanales from './routes/canales.mjs';
import rArchivos from './routes/archivos.mjs';
import rVarios from './routes/varios.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);

for (const v of ['DATABASE_URL', 'JWT_SECRET']) {
  if (!process.env[v]) { console.error(`\n✖ Falta la variable ${v} en el archivo .env\n`); process.exit(1); }
}
if (process.env.JWT_SECRET.length < 24) {
  console.error('\n✖ JWT_SECRET debe tener al menos 24 caracteres.\n'); process.exit(1);
}

const app = express();
app.set('trust proxy', 1);
app.use(compression());
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
      mediaSrc: ["'self'", 'data:', 'blob:'],
      connectSrc: ["'self'", 'https://api.open-meteo.com', 'https://geocoding-api.open-meteo.com'],
      fontSrc: ["'self'", 'data:'],
      objectSrc: ["'none'"],
      frameAncestors: ["'self'"]
    }
  },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}));
app.use(cors({ origin: process.env.CORS_ORIGIN || true, credentials: true }));

// El multipart de subida se lee como stream en su propia ruta
app.use((req, res, next) => {
  if (req.path === '/api/archivos' && req.method === 'POST') return next();
  express.json({ limit: '5mb', verify: (r2, _s, buf) => { r2.rawBody = buf; } })(req, res, next);
});

/* ---------- Webhook de Meta ---------- */
app.get('/webhook/meta', meta.verificarWebhook);
app.post('/webhook/meta', (req, res) => {
  if (!meta.firmaValida(req)) { console.warn('[meta] firma inválida'); return res.sendStatus(403); }
  meta.recibirWebhook(req, res);
});

/* ---------- Login ---------- */
const limiteLogin = rateLimit({
  windowMs: 10 * 60 * 1000, max: 20,
  message: { error: 'Demasiados intentos. Esperá unos minutos.' },
  standardHeaders: true, legacyHeaders: false
});

app.post('/api/login', limiteLogin, async (req, res) => {
  const r = await login(req.body || {});
  if (r.error) return res.status(401).json({ error: r.error });
  const { user, empresa } = r;
  await auditar(empresa?.id || null, user.nombre, 'Ingreso', 'Login correcto', req.ip);
  res.json({ token: r.token, usuario: publicoUsuario(user), empresa: empresa ? publica(empresa) : null });
});

const publicoUsuario = u => ({
  id: u.id, nombre: u.nombre, usuario: u.usuario, rol: u.rol, sucursal: u.sucursal, linea: u.linea,
  foto: u.foto, nacimiento: u.nacimiento, disponibilidad: u.disponibilidad, email: u.email, tel: u.tel,
  prefs: u.prefs || {}, esAdminGlobal: u.rol === 'admin' && !u.empresa_id
});
const publica = e => ({
  id: e.id, codigo: e.codigo, nombre: e.nombre, color: e.color, logo: e.logo, ciudad: e.ciudad,
  etapas: e.etapas, motivos: e.motivos, modulos: e.modulos, lineas: e.lineas,
  flags: e.flags, notis: e.notis, reglas: e.reglas, stock: e.stock, bot: e.bot
});

app.get('/api/contexto', requiere(), async (req, res) => {
  const { rows: sucs } = req.empresaId
    ? await q('SELECT * FROM sucursales WHERE empresa_id=$1 AND activa ORDER BY nombre', [req.empresaId])
    : { rows: [] };
  const { rows: empresas } = req.esAdmin
    ? await q('SELECT id,codigo,nombre,color FROM empresas WHERE activa ORDER BY nombre')
    : { rows: [] };
  res.json({
    empresa: req.empresa ? publica(req.empresa) : null,
    sucursales: sucs, empresas, usuario: publicoUsuario(req.user)
  });
});

app.get('/api/stream', requiere(), sseHandler);

app.use('/api/negociaciones', rNegociaciones);
app.use('/api/contactos', rContactos);
app.use('/api/admin', rAdmin);
app.use('/api/canales', rCanales);
app.use('/api/archivos', rArchivos);
app.use('/api', rVarios);

app.get('/api/health', async (_req, res) => {
  try { await q('SELECT 1'); res.json({ ok: true, ts: Date.now(), version: '2.1.0' }); }
  catch (e) { res.status(503).json({ ok: false, error: 'base de datos no disponible' }); }
});

/* ---------- Archivos subidos ----------
   Públicos a propósito: Meta necesita descargarlos por URL al reenviarlos.
   Los nombres son UUID irreproducibles, así que no son adivinables. */
app.use('/media', express.static(MEDIA_DIR, {
  maxAge: '30d',
  setHeaders: r2 => {
    r2.setHeader('X-Content-Type-Options', 'nosniff');
    r2.setHeader('Content-Disposition', 'inline');
  }
}));

/* ---------- Front ---------- */
app.use(express.static(join(__dirname, '..', 'public'), { maxAge: '1h', index: 'index.html' }));
app.get(/^(?!\/api|\/webhook|\/media).*/, (_req, res) =>
  res.sendFile(join(__dirname, '..', 'public', 'index.html')));

app.use((err, _req, res, _next) => {
  console.error('[error]', err);
  res.status(500).json({ error: 'error interno del servidor' });
});

/* ---------- Arranque ---------- */
(async () => {
  console.log('\n· iciia2.0 — iniciando');
  await migrar();
  await seed();
  arrancarWorkers();
  await baileys.prelevantar();
  setInterval(() => motorSLA().catch(e => console.error('[sla]', e.message)), 60000);
  setInterval(() => avisarCumples().catch(() => {}), 6 * 60 * 60 * 1000);
  avisarCumples().catch(() => {});
  app.listen(PORT, () => {
    console.log(`✔ Servidor escuchando en http://localhost:${PORT}`);
    if (process.env.PUBLIC_URL) console.log(`  Webhook de Meta: ${process.env.PUBLIC_URL}/webhook/meta`);
    if (!process.env.META_VERIFY_TOKEN) console.warn('  ⚠ Sin META_VERIFY_TOKEN: los canales de Meta no podrán verificarse.');
  });
})().catch(e => { console.error('✖ Falló el arranque:', e); process.exit(1); });

for (const s of ['SIGTERM', 'SIGINT']) {
  process.on(s, () => { console.log(`\n· ${s} recibido, cerrando…`); process.exit(0); });
}
