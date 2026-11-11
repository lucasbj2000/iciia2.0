// IMPAR: seguridad de acceso — contraseñas, verificación en dos pasos, sesiones, cabeceras y archivos.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { problemaClave, codigoTOTP, verificarTOTP, nuevoSecretoTOTP, uriTOTP, cifrarSecreto, descifrarSecreto } from '../src/seguridad-impar.mjs';
const leer = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');

// Política de contraseñas
for (const mala of ['1234', 'abcdefghij', '1234567890', 'impar2026', 'aaaaaaaaaa1', 'Andrea12345']) assert.ok(problemaClave(mala, { usuario: 'andrea', nombre: 'Andrea Recalde' }), 'Rechaza ' + mala);
assert.equal(problemaClave('Cartulina.Verde42', { usuario: 'andrea', nombre: 'Andrea Recalde' }), null);
assert.ok(problemaClave('MiClaveRecalde9', { usuario: 'ar', nombre: 'Andrea Recalde' }).includes('nombre'));

// TOTP: vector de prueba de la RFC 6238 (secreto ASCII «12345678901234567890», t=59 s → 287082 en 6 dígitos)
const RFC = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
assert.equal(codigoTOTP(RFC, Math.floor(59 / 30)), '287082');
assert.equal(codigoTOTP(RFC, Math.floor(1111111109 / 30)), '081804');
const s = nuevoSecretoTOTP(); assert.match(s, /^[A-Z2-7]{32}$/);
const ahora = Date.UTC(2026, 10, 10, 12, 0, 15), paso = Math.floor(ahora / 30000);
assert.equal(verificarTOTP(s, codigoTOTP(s, paso), { ahora }), paso);
assert.equal(verificarTOTP(s, codigoTOTP(s, paso - 1), { ahora }), paso - 1, 'Tolera 30 s de desfase');
assert.equal(verificarTOTP(s, codigoTOTP(s, paso - 3), { ahora }), null, 'Un código viejo no sirve');
assert.equal(verificarTOTP(s, codigoTOTP(s, paso), { ahora, ultimoPaso: paso }), null, 'Un código usado no sirve dos veces');
assert.equal(verificarTOTP(s, 'abc123', { ahora }), null);
assert.ok(uriTOTP(s, 'andrea').startsWith('otpauth://totp/IMPAR%20CRM%3Aandrea?secret=' + s));
process.env.JWT_SECRET = 'x'.repeat(32);
const c = cifrarSecreto(s); assert.ok(c.startsWith('totp:v1:') && !c.includes(s), 'El secreto se guarda cifrado');
assert.equal(descifrarSecreto(c), s);

// Inicio de sesión y sesiones
const auth = leer('src/auth.mjs'), server = leer('src/server.mjs'), mig = leer('src/migrations/039_seguridad_acceso_impar.sql');
assert.ok(auth.includes("bcrypt.compare(clave, user?.pass_hash || SENUELO)"), 'Misma demora exista o no la cuenta');
assert.ok(auth.includes('await minutosBloqueo(q, us)') && auth.includes('registrarIntento(q, us, ip, false)'), 'Bloqueo por cuenta tras intentos fallidos');
assert.ok(auth.includes("(p.ver || 0) !== (user.sesion_version || 0)"), 'Sesiones revocables');
assert.ok(auth.includes("algorithms: ['HS256']") && auth.includes("startsWith('/api/stream') ? String(req.query.token"), 'Firma fija y token por dirección solo en el canal en vivo');
assert.ok(auth.includes('user.debe_cambiar_clave && !PERMITIDO_SIN_CAMBIO.test'), 'Contraseña vencida: solo puede cambiarla');
assert.ok(mig.includes('NEW.sesion_version := OLD.sesion_version + 1') && mig.includes('BEFORE INSERT ON usuarios'), 'Cambio de clave, rol o baja cierra sesiones; altas cambian la clave al entrar');
assert.ok(!leer('src/routes/admin.mjs').includes("'1234'") && !leer('public/js/admin.js').includes('value="1234"'), 'Sin contraseña por defecto');
for (const f of ['src/routes/admin.mjs', 'src/routes/edicion.mjs', 'src/routes/organigrama.mjs', 'src/routes/varios.mjs']) assert.ok(leer(f).includes('problemaClave('), 'Política aplicada en ' + f);

// Cabeceras, origen y archivos
assert.ok(server.includes("process.env.CORS_ORIGIN.split(',')") && server.includes(': false, credentials: true'), 'La API no acepta llamadas desde otros sitios');
assert.ok(server.includes("skipSuccessfulRequests: true") && server.includes("app.use('/api', rateLimit("), 'Frenos de solicitudes');
assert.ok(server.includes("sandbox\");") && server.includes('Permissions-Policy'), 'Archivos subidos aislados');
assert.ok(server.includes("app.post('/api/login/2fa'") && server.includes("app.post('/api/sesion/cerrar-todas'"));
assert.ok(leer('public/js/app.js').includes('seg.pedirCodigoLogin(r.desafio)') && leer('public/js/app.js').includes('seg.forzarCambioClave(clave)'));
console.log('✔ IMPAR: contraseñas, dos pasos, bloqueo, sesiones revocables, cabeceras y archivos aislados.');
