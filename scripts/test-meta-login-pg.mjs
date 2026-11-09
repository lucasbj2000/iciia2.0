/** «Conectar con Facebook» en PostgreSQL real: un solo uso, por usuario, tokens cifrados, vencimiento y canales.
 * Esquema aislado; requiere TEST_DATABASE_URL. Meta simulado: nunca sale a Internet. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
if (!process.env.TEST_DATABASE_URL) throw Error('Solo para base de pruebas; TEST_DATABASE_URL obligatorio.');
const schema = 'impar_fb_' + randomUUID().replaceAll('-', '');
const admin = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
await admin.connect();
await admin.query(`CREATE SCHEMA "${schema}"`);
Object.assign(process.env, { DATABASE_URL: process.env.TEST_DATABASE_URL, PGOPTIONS: `-c search_path=${schema},public`,
  META_APP_SECRET: 'secreto_prueba', META_TOKEN_ENCRYPTION_KEY: 'b'.repeat(64), GRAPH_VERSION: 'v21.0' });
const E = randomUUID(), OTRA = randomUUID(), U = randomUUID(), U2 = randomUUID(), SUC = randomUUID();
let pool;
try {
  await admin.query(`SET search_path TO "${schema}"`);
  await admin.query(`CREATE TABLE empresas(id uuid PRIMARY KEY);
    CREATE TABLE sucursales(id uuid PRIMARY KEY, empresa_id uuid, nombre text);
    CREATE TABLE canales(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), empresa_id uuid, sucursal_id uuid, linea text, tipo text, nombre text,
      config jsonb DEFAULT '{}', activo boolean, bot_activo boolean DEFAULT true, estado text, ultimo_error text, ultima_conexion timestamptz);`);
  await admin.query(readFileSync(new URL('../src/migrations/034_meta_login_impar.sql', import.meta.url), 'utf8'));
  await admin.query('INSERT INTO empresas VALUES ($1),($2)', [E, OTRA]);
  await admin.query("INSERT INTO sucursales VALUES ($1,$2,'Central')", [SUC, E]);

  const L = await import('../src/meta-login-impar.mjs');
  const { resolverToken } = await import('../src/meta-secretos-impar.mjs');
  ({ pool } = await import('../src/db.mjs'));
  const llamadas = [];
  const meta = async (url, op = {}) => {
    const u = String(url); llamadas.push({ u, op });
    const json = (o, ok = true) => ({ ok, json: async () => o });
    if (u.includes('oauth/access_token')) return u.includes('code=MALO') ? json({ error: { code: 100, message: 'Invalid verification code' } }, false)
      : json({ access_token: u.includes('fb_exchange_token') ? 'LARGO' : 'CORTO' });
    if (u.includes('/me/accounts')) return json({ data: [{ id: '111', name: 'Papelerías IMPAR', access_token: 'TOKEN_PAG', instagram_business_account: { id: '999', username: 'impar.py' } },
      { id: '222', name: 'Sin IG', access_token: 'TOKEN_2' }] });
    if (u.includes('subscribed_apps')) return json({ success: true });
    return json({ error: { message: 'no simulado' } }, false);
  };
  const BASE = 'https://crm.iciia.tech';

  await L.guardarAjustes(E, '123456789');
  assert.equal((await L.leerAjustes(E)).configId, '123456789');
  const { state, url } = await L.iniciar({ empresaId: E, usuarioId: U, configId: '123456789', base: BASE });
  assert.match(state, /^[0-9a-f]{64}$/);
  const dialogo = new URL(url);
  assert.equal(dialogo.origin, 'https://www.facebook.com');
  assert.equal(dialogo.pathname, '/v26.0/dialog/oauth', 'versión vigente aunque el .env diga v21');
  assert.equal(dialogo.searchParams.get('config_id'), '123456789');
  assert.equal(dialogo.searchParams.get('redirect_uri'), 'https://crm.iciia.tech/api/meta-login/retorno');
  assert.equal(dialogo.searchParams.get('response_type'), 'code');
  assert.equal(dialogo.searchParams.has('scope'), false, 'apps de empresa usan config_id, no scope');

  // Retornos inválidos.
  assert.equal((await L.completar({ state: 'x', code: 'A', base: BASE }, meta)).ok, false);
  assert.equal((await L.completar({ state: 'f'.repeat(64), code: 'A', base: BASE }, meta)).ok, false, 'state inventado');
  assert.equal((await L.verEstado(state, E, U2)), null, 'otro usuario no ve el intento');

  // Retorno correcto: código → token corto → largo → páginas con tokens cifrados.
  const ok = await L.completar({ state, code: 'BUENO', base: BASE }, meta);
  assert.equal(ok.ok, true);
  const canje = llamadas.find(l => l.u.includes('code=BUENO'));
  assert.ok(canje.u.includes('redirect_uri=https%3A%2F%2Fcrm.iciia.tech%2Fapi%2Fmeta-login%2Fretorno'));
  assert.ok(llamadas.some(l => l.u.includes('fb_exchange_token=CORTO')), 'se pide el token largo');
  const fila = (await admin.query('SELECT paginas::text FROM meta_login_estados WHERE state=$1', [state])).rows[0].paginas;
  assert.ok(!fila.includes('TOKEN_PAG') && !fila.includes('LARGO'), 'ningún token en claro en la base');
  assert.equal((await L.completar({ state, code: 'BUENO', base: BASE }, meta)).ok, false, 'el retorno no se repite');
  const visto = await L.verEstado(state, E, U);
  assert.equal(visto.estado, 'listo');
  assert.deepEqual(visto.paginas.map(p => [p.page_id, p.ig_usuario]), [['111', 'impar.py'], ['222', '']]);
  assert.ok(!JSON.stringify(visto).includes('token'), 'el navegador nunca recibe tokens');

  // Validaciones al conectar (no consumen el intento si fallan antes).
  await assert.rejects(L.conectar({ state, empresaId: E, usuarioId: U2, pageId: '111', messenger: true }, meta), /venció o ya se usó/, 'otro usuario no puede usarlo');
  await assert.rejects(L.conectar({ state, empresaId: OTRA, usuarioId: U, pageId: '111', messenger: true }, meta), /venció o ya se usó/, 'otra empresa no puede usarlo');

  const r = await L.conectar({ state, empresaId: E, usuarioId: U, pageId: '111', messenger: true, instagram: true, sucursalId: SUC }, meta);
  assert.deepEqual(r.canales.map(c => [c.tipo, c.actualizado]), [['messenger', false], ['instagram', false]]);
  const canales = (await admin.query("SELECT tipo,nombre,config,bot_activo,activo,sucursal_id FROM canales ORDER BY tipo")).rows;
  assert.equal(canales.length, 2);
  assert.ok(canales.every(c => c.bot_activo === false && c.activo === true && c.sucursal_id === SUC));
  assert.ok(canales.every(c => c.config.token.startsWith('enc:') && resolverToken(c.config.token) === 'TOKEN_PAG'), 'token de página cifrado');
  assert.equal(canales.find(c => c.tipo === 'instagram').nombre, 'Instagram @impar.py');
  assert.ok(llamadas.some(l => l.u.includes('/111/subscribed_apps') && l.op.method === 'POST'), 'página suscrita');
  await assert.rejects(L.conectar({ state, empresaId: E, usuarioId: U, pageId: '111', messenger: true }, meta), /venció o ya se usó/, 'un intento, un uso');

  // Segunda conexión de la misma página: renueva el acceso, no duplica canales.
  const s2 = (await L.iniciar({ empresaId: E, usuarioId: U, configId: '123456789', base: BASE })).state;
  await L.completar({ state: s2, code: 'BUENO', base: BASE }, meta);
  const r2 = await L.conectar({ state: s2, empresaId: E, usuarioId: U, pageId: '111', messenger: true }, meta);
  assert.equal(r2.canales[0].actualizado, true);
  assert.equal((await admin.query('SELECT count(*)::int n FROM canales')).rows[0].n, 2, 'no duplica');

  // Instagram pedido para una página sin Instagram.
  const s3 = (await L.iniciar({ empresaId: E, usuarioId: U, configId: '1', base: BASE })).state;
  await L.completar({ state: s3, code: 'BUENO', base: BASE }, meta);
  await assert.rejects(L.conectar({ state: s3, empresaId: E, usuarioId: U, pageId: '222', instagram: true }, meta), /no tiene Instagram/);
  assert.equal((await L.verEstado(s3, E, U)).estado, 'listo', 'un error al elegir no gasta el inicio de sesión');
  assert.equal((await L.conectar({ state: s3, empresaId: E, usuarioId: U, pageId: '222', messenger: true }, meta)).canales[0].tipo, 'messenger');

  // La misma página no se puede llevar a otro CRM.
  const s4 = (await L.iniciar({ empresaId: OTRA, usuarioId: U2, configId: '1', base: BASE })).state;
  await L.completar({ state: s4, code: 'BUENO', base: BASE }, meta);
  await assert.rejects(L.conectar({ state: s4, empresaId: OTRA, usuarioId: U2, pageId: '111', messenger: true }, meta), /otro CRM/);

  // Código rechazado, cancelación y vencimiento.
  const s5 = (await L.iniciar({ empresaId: E, usuarioId: U, configId: '1', base: BASE })).state;
  assert.match((await L.completar({ state: s5, code: 'MALO', base: BASE }, meta)).mensaje, /Invalid verification code/);
  assert.equal((await L.verEstado(s5, E, U)).estado, 'error');
  const s6 = (await L.iniciar({ empresaId: E, usuarioId: U, configId: '1', base: BASE })).state;
  assert.match((await L.completar({ state: s6, error: 'access_denied', base: BASE }, meta)).mensaje, /Se canceló/);
  const s7 = (await L.iniciar({ empresaId: E, usuarioId: U, configId: '1', base: BASE })).state;
  await admin.query("UPDATE meta_login_estados SET vence=now()-interval '1 minute' WHERE state=$1", [s7]);
  assert.equal((await L.verEstado(s7, E, U)).estado, 'error');
  assert.match((await L.completar({ state: s7, code: 'BUENO', base: BASE }, meta)).mensaje, /15 minutos/);
  console.log('✔ Conectar con Facebook: un solo uso, por usuario y empresa, tokens cifrados, renovación sin duplicar y vencimiento.');
} finally {
  await pool?.end().catch(() => {});
  await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => {});
  await admin.end();
}
