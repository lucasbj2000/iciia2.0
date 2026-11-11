import 'dotenv/config';
// Errores en rutas async → manejador de errores (antes un error podía detener todo el proceso).
import './async-errors.mjs';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';

import { q, migrar, seed } from './db.mjs';
import { prepararRecepcionImpar } from './preparar-recepcion-impar.mjs';
import { login, login2fa, requiere, firmar } from './auth.mjs';
import { sseHandler } from './realtime.mjs';
import { motorSLA, avisarCumples, auditar, notificar } from './core.mjs';
import { arrancarWorkers } from './worker.mjs';
import rCampanas from './routes/campanas.mjs';
import { MEDIA_DIR } from './archivos.mjs';
import * as baileys from './channels/baileys.mjs';
import * as meta from './channels/meta.mjs';

import rNegociaciones from './routes/negociaciones.mjs';
import rHistoricosImpar from './routes/historicos-impar.mjs';
import rContactos from './routes/contactos.mjs';
import rAdmin from './routes/admin.mjs';
import rCatalogosImpar from './routes/catalogos-impar.mjs';
import rAccesos from './routes/accesos.mjs';
import rOrganigrama from './routes/organigrama.mjs';
import rColaboracion from './routes/colaboracion.mjs';
import rCanales from './routes/canales.mjs';
import rMetaLogin from './routes/meta-login.mjs';
import rMetaLaboratorio from './routes/meta-laboratorio-impar.mjs';
import rArchivos from './routes/archivos.mjs';
import rProyecto from './routes/proyecto.mjs';
import rAyudas from './routes/ayudas.mjs';
import rHorarios from './routes/horarios.mjs';
import rBitrix from './routes/importar-bitrix.mjs';
import rVarios from './routes/varios.mjs';
import rSoporte from './routes/soporte.mjs';
import rEnlaces, { redirigirEnlace, limiteEnlaces } from './routes/enlaces-impar.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const BUILD_SHA = (() => {
  try {
    return execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], {
      cwd: join(__dirname, '..'),
      encoding: 'utf8'
    }).trim();
  } catch {
    return process.env.BUILD_SHA || 'desconocido';
  }
})();

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
// Solo el propio CRM (o el origen configurado) puede llamar a la API desde un navegador.
app.use(cors({ origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',').map(x => x.trim()) : false, credentials: true }));
app.use((_req, res, next) => {
  // Sin cámara, micrófono de terceros, pagos ni seguimiento publicitario.
  res.setHeader('Permissions-Policy', 'camera=(), geolocation=(self), microphone=(self), payment=(), usb=(), interest-cohort=()');
  next();
});
// Freno general por dirección: generoso (una sucursal entera comparte la misma salida a internet).
app.use('/api', rateLimit({
  windowMs: 5 * 60 * 1000, max: Number(process.env.LIMITE_API_5MIN || 3000),
  standardHeaders: true, legacyHeaders: false,
  skip: req => req.path === '/stream',
  message: { error: 'Demasiadas solicitudes seguidas. Esperá un momento.' }
}));

// El multipart de subida se lee como stream en su propia ruta
app.use((req, res, next) => {
  if (['/api/archivos', '/api/proyecto/documentos', '/api/admin/catalogos/importar'].includes(req.path) && req.method === 'POST') return next();
  express.json({ limit: '5mb', verify: (r2, _s, buf) => { r2.rawBody = buf; } })(req, res, next);
});

/* ---------- Enlaces de WhatsApp por agente (público) ---------- */
app.get('/w/:usuario', limiteEnlaces, redirigirEnlace);

/* ---------- Webhook de Meta ---------- */
app.get('/webhook/meta', meta.verificarWebhook);
app.post('/webhook/meta', (req, res) => {
  if (!meta.firmaValida(req)) { console.warn('[meta] firma inválida'); return res.sendStatus(403); }
  meta.recibirWebhook(req, res);
});

/* ---------- Login ---------- */
// Por dirección: solo cuentan los intentos fallidos (los ingresos correctos de toda una sucursal no se frenan).
const limiteLogin = rateLimit({
  windowMs: 10 * 60 * 1000, max: 20, skipSuccessfulRequests: true,
  message: { error: 'Demasiados intentos fallidos desde esta conexión. Esperá unos minutos.' },
  standardHeaders: true, legacyHeaders: false
});

async function avisarBloqueo(usuario, ip) {
  const { rows } = await q("SELECT u.nombre, e.* FROM usuarios u JOIN empresas e ON e.id=u.empresa_id WHERE lower(u.usuario)=$1 LIMIT 1", [usuario]);
  const emp = rows[0] || (await q("SELECT * FROM empresas WHERE codigo='impar' LIMIT 1")).rows[0];
  if (!emp) return;
  await auditar(emp.id, 'Sistema', 'Seguridad', `Cuenta pausada 15 min por intentos fallidos: ${usuario}`, ip);
  const { rows: admins } = await q("SELECT id FROM usuarios WHERE empresa_id=$1 AND rol='admin' AND activo", [emp.id]);
  if (admins.length) await notificar(emp, 'seguridad', { mensajeCompleto: `Se pausó el acceso de «${usuario}» por 5 intentos fallidos de contraseña o código. Si no fue esa persona, cambiale la contraseña.` }, admins.map(a => a.id), null);
}

async function responderLogin(req, res, r) {
  if (r.recienBloqueada) avisarBloqueo(r.usuario, req.ip).catch(e => console.warn('[login] aviso de bloqueo:', e.name));
  if (r.bloqueada) return res.status(429).json({ error: r.error });
  if (r.error) return res.status(401).json({ error: r.error, ...(r.reiniciar ? { reiniciar: true } : {}) });
  if (r.requiere2fa) return res.json({ requiere2fa: true, desafio: r.desafio });
  const { user, empresa } = r;
  // Un error al guardar auditoría NO debe impedir un login válido.
  auditar(empresa?.id || null, user.nombre, 'Ingreso', 'Login correcto', req.ip)
    .catch(e => console.warn('[login] Auditoría no disponible:', e.message));
  res.json({ token: r.token, usuario: publicoUsuario(user), empresa: empresa ? publica(empresa) : null });
}

app.post('/api/login', limiteLogin, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try { await responderLogin(req, res, await login(req.body || {}, req.ip)); }
  catch (e) {
    console.error('[login] Error operativo:',e.message);
    res.status(503).json({ error: 'El servicio de acceso está temporalmente indisponible. Intentá nuevamente.' });
  }
});
app.post('/api/login/2fa', limiteLogin, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try { await responderLogin(req, res, await login2fa(req.body || {}, req.ip)); }
  catch (e) {
    console.error('[login] Error operativo 2FA:', e.message);
    res.status(503).json({ error: 'El servicio de acceso está temporalmente indisponible. Intentá nuevamente.' });
  }
});

// Monitoreo del circuito de autenticación sin credenciales ni datos personales.
app.get('/api/login/health', async (_req,res) => {
  res.set('Cache-Control','no-store');
  try {
    const { rows } = await q("SELECT EXISTS(SELECT 1 FROM empresas WHERE codigo='impar' AND activa) AS listo");
    if (!rows[0]?.listo) return res.status(503).json({ok:false,error:'configuracion no lista'});
    return res.json({ok:true,build:BUILD_SHA});
  } catch (e) {
    return res.status(503).json({ok:false,error:'acceso temporalmente indisponible'});
  }
});

const publicoUsuario = u => ({
  id: u.id, nombre: u.nombre, usuario: u.usuario, rol: u.rol, sucursal: u.sucursal, linea: u.linea,
  foto: u.foto, nacimiento: u.nacimiento, disponibilidad: u.disponibilidad, email: u.email, tel: u.tel,
  prefs: u.prefs || {}, esAdminGlobal: u.rol === 'admin' && !u.empresa_id,
  debeCambiarClave: !!u.debe_cambiar_clave, dosPasos: !!u.totp_activo
});
const publica = e => ({
  id: e.id, codigo: e.codigo, nombre: e.nombre, color: e.color, logo: e.logo, ciudad: e.ciudad,
  etapas: e.etapas, motivos: e.motivos, modulos: e.modulos, lineas: e.lineas,
  flags: e.flags, notis: e.notis, reglas: e.reglas, stock: e.stock, bot: e.bot
});

app.post('/api/sesion/renovar', requiere(), (req,res) => {
  res.set('Cache-Control','no-store');
  res.json({token: firmar(req.user)});
});
// Cierra la sesión en todos los dispositivos (celular perdido, computadora compartida…).
app.post('/api/sesion/cerrar-todas', requiere(), async (req, res) => {
  await q('UPDATE usuarios SET sesion_version=sesion_version+1 WHERE id=$1', [req.user.id]);
  await auditar(req.empresaId, req.user.nombre, 'Seguridad', 'Cerró la sesión en todos los dispositivos', req.ip);
  res.json({ ok: true });
});

app.get('/api/contexto', requiere(), async (req, res) => {
  const [sucs, empresas] = await Promise.all([
    req.empresaId
      ? q('SELECT * FROM sucursales WHERE empresa_id=$1 AND activa ORDER BY nombre', [req.empresaId])
      : Promise.resolve({rows:[]}),
    req.esAdmin
      ? q("SELECT id,codigo,nombre,color FROM empresas WHERE activa AND codigo='impar'")
      : Promise.resolve({rows:[]})
  ]);
  res.json({
    empresa: req.empresa ? publica(req.empresa) : null,
    sucursales: sucs.rows, empresas: empresas.rows, usuario: publicoUsuario(req.user)
  });
});

app.get('/api/stream', requiere(), sseHandler);

app.use('/api/negociaciones', rNegociaciones);
app.use('/api/negociaciones', rHistoricosImpar);
app.use('/api/negociaciones', rColaboracion);
app.use('/api/contactos', rContactos);
app.use('/api/admin/accesos', rAccesos);
app.use('/api/admin/catalogos', rCatalogosImpar);
app.use('/api/admin', rAdmin);
app.use('/api/organigrama', rOrganigrama);
app.use('/api/canales', rCanales);
app.use('/api/meta-login', rMetaLogin);
app.use('/api/meta-laboratorio', rMetaLaboratorio);
app.use('/api/archivos', rArchivos);
app.use('/api/proyecto', rProyecto);
app.use('/api/ayudas', rAyudas);
app.use('/api/horarios', rHorarios);
app.use('/api/bitrix', rBitrix);
app.use('/api/enlaces', rEnlaces);
app.use('/api/soporte', rSoporte);
app.use('/api/campanas', rCampanas);
app.use('/api', rVarios);

app.get('/api/health', async (_req, res) => {
  try {
    await q('SELECT 1');
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ok: true, ts: Date.now(), version: '3.0.0-impar', build: BUILD_SHA });
  } catch (e) {
    res.status(503).json({ ok: false, error: 'base de datos no disponible', build: BUILD_SHA });
  }
});

/* ---------- Archivos subidos ----------
   Públicos a propósito: Meta necesita descargarlos por URL al reenviarlos.
   Los nombres son UUID irreproducibles, así que no son adivinables. */
app.use('/media', express.static(MEDIA_DIR, {
  maxAge: '30d',
  setHeaders: r2 => {
    r2.setHeader('X-Content-Type-Options', 'nosniff');
    r2.setHeader('Content-Disposition', 'inline');
    // Un archivo subido nunca puede ejecutar código en el CRM, aunque alguien lo disfrace.
    r2.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; sandbox");
  }
}));

/* ---------- Front ----------
   El CRM cambia con frecuencia. HTML/JS/CSS deben revalidarse siempre para
   evitar que móviles y navegadores sigan ejecutando una revisión anterior.
   Los adjuntos /media conservan su caché larga por separado. */
app.use(express.static(join(__dirname, '..', 'public'), {
  maxAge: 0,
  etag: true,
  lastModified: true,
  index: 'index.html',
  setHeaders: (res, path) => {
    if (/\.html$/i.test(path)) {
      // El documento principal siempre es fresco y decide la versión pública.
      res.setHeader('Cache-Control','no-store, must-revalidate');
    } else if (/\.(?:js|css)$/i.test(path)) {
      // Permitir respuestas 304 con ETag: conservamos la última versión, sin
      // descargar decenas de módulos otra vez en cada login o recarga.
      res.setHeader('Cache-Control','no-cache, must-revalidate');
    }
    res.setHeader('X-ICIIA-Build', BUILD_SHA);
  }
}));
// Política de privacidad pública (requerida por Meta para publicar la app de WhatsApp Cloud API).
app.get(['/privacidad', '/privacidad/'], (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache, must-revalidate');
  res.sendFile(join(__dirname, '..', 'public', 'privacidad.html'));
});
app.get(/^(?!\/api|\/webhook|\/media).*/, (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('X-ICIIA-Build', BUILD_SHA);
  res.sendFile(join(__dirname, '..', 'public', 'index.html'));
});

app.use((err, _req, res, _next) => {
  console.error('[error]', err);
  if (res.headersSent) return;
  res.status(500).json({ error: 'error interno del servidor' });
});

/* ---------- Arranque ---------- */
(async () => {
  console.log('\n· iciia2.0 — iniciando');
  await migrar();
  await seed();
  await prepararRecepcionImpar();
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

