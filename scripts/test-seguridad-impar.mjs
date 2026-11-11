// IMPAR: seguridad de acceso — bloqueo por intentos, sesiones revocables, cabeceras y archivos aislados.
// Por decisión de administración no hay verificación en dos pasos ni cambio obligatorio de contraseña.
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { problemaClave } from '../src/seguridad-impar.mjs';
const leer = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');

assert.equal(problemaClave('1234'), null, 'Mismo mínimo de siempre (4)');
assert.ok(problemaClave('123'));
assert.ok(problemaClave('1234567', { min: 8 }), 'Organigrama mantiene 8');

const auth = leer('src/auth.mjs'), server = leer('src/server.mjs');
assert.ok(auth.includes("bcrypt.compare(clave, user?.pass_hash || SENUELO)"), 'Misma demora exista o no la cuenta');
assert.ok(auth.includes('await minutosBloqueo(q, us)') && auth.includes('registrarIntento(q, us, ip, false)'), 'Bloqueo por cuenta tras intentos fallidos');
assert.ok(auth.includes("(p.ver || 0) !== (user.sesion_version || 0)"), 'Sesiones revocables');
assert.ok(auth.includes("algorithms: ['HS256']") && auth.includes("startsWith('/api/stream') ? String(req.query.token"), 'Firma fija y token por dirección solo en el canal en vivo');
assert.ok(!auth.includes('debe_cambiar_clave') && !auth.includes('totp'), 'Sin cambio obligatorio ni dos pasos');
assert.ok(!server.includes('/api/login/2fa') && !leer('src/routes/varios.mjs').includes('/perfil/2fa'), 'Sin rutas de dos pasos');
const m40 = leer('src/migrations/040_seguridad_sin_cambio_obligatorio_impar.sql');
assert.ok(m40.includes('DROP TRIGGER IF EXISTS usuarios_alta_clave_impar') && m40.includes('SET debe_cambiar_clave=FALSE') && !m40.includes('debe_cambiar_clave := TRUE'));

assert.ok(server.includes("process.env.CORS_ORIGIN.split(',')") && server.includes(': false, credentials: true'), 'La API no acepta llamadas desde otros sitios');
assert.ok(server.includes("skipSuccessfulRequests: true") && server.includes("app.use('/api', rateLimit("), 'Frenos de solicitudes');
assert.ok(server.includes("sandbox\");") && server.includes("!/\\.pdf$/i.test(ruta)") && server.includes('Permissions-Policy'), 'Archivos subidos aislados');
assert.ok(server.includes("app.post('/api/sesion/cerrar-todas'") && leer('public/js/seguridad.js').includes('/sesion/cerrar-todas'));
assert.ok(!leer('public/js/app.js').includes('pedirCodigoLogin') && !leer('public/js/app.js').includes('forzarCambioClave'));
console.log('✔ IMPAR: bloqueo por intentos, sesiones revocables, cabeceras y archivos aislados (sin dos pasos ni cambio obligatorio).');
