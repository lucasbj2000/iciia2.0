/** Seguridad de acceso en PostgreSQL real: versión de sesión por disparador
 * y bloqueo de cuenta por intentos fallidos (sin delatar si la cuenta existe). */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { minutosBloqueo, registrarIntento, BLOQUEO } from '../src/seguridad-impar.mjs';
if (!process.env.TEST_DATABASE_URL) throw Error('Solo para base de pruebas; TEST_DATABASE_URL obligatorio.');
const schema = 'impar_seg_' + randomUUID().replaceAll('-', '');
const db = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
await db.connect();
const q = (sql, p) => db.query(sql, p);
try {
  await q(`CREATE SCHEMA "${schema}"`); await q(`SET search_path TO "${schema}"`);
  await q(`CREATE TABLE empresas(id uuid PRIMARY KEY, notis jsonb DEFAULT '[]');
    CREATE TABLE usuarios(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), empresa_id uuid, usuario text, pass_hash text, rol text, activo boolean DEFAULT true);`);
  await q("INSERT INTO empresas(id) VALUES (gen_random_uuid())");
  const mig = readFileSync(new URL('../src/migrations/039_seguridad_acceso_impar.sql', import.meta.url), 'utf8');
  await q(mig); await q(mig); // idempotente
  const m40 = readFileSync(new URL('../src/migrations/040_seguridad_sin_cambio_obligatorio_impar.sql', import.meta.url), 'utf8');
  await q(m40); await q(m40);
  const { rows: [e] } = await q('SELECT notis FROM empresas');
  assert.equal(e.notis.filter(n => n.k === 'seguridad').length, 1, 'Aviso de seguridad agregado una sola vez');

  const { rows: [u] } = await q("INSERT INTO usuarios(usuario,pass_hash,rol) VALUES('ana','h1','agente') RETURNING *");
  assert.equal(u.debe_cambiar_clave, false, 'Sin cambio obligatorio al crear');
  const ver = async () => (await q('SELECT sesion_version v, debe_cambiar_clave d FROM usuarios WHERE id=$1', [u.id])).rows[0];
  assert.deepEqual(await ver(), { v: 0, d: false }, 'Cambiar otra cosa no toca la sesión');
  await q("UPDATE usuarios SET pass_hash='h2' WHERE id=$1", [u.id]);
  assert.deepEqual(await ver(), { v: 1, d: false }, 'Cambio de clave: cierra sesiones, sin pedir cambio');
  await q("UPDATE usuarios SET rol='jefe' WHERE id=$1", [u.id]); assert.equal((await ver()).v, 2, 'Cambio de rol');
  await q('UPDATE usuarios SET activo=false WHERE id=$1', [u.id]); assert.equal((await ver()).v, 3, 'Baja');

  // Bloqueo: cuenta que existe y cuenta que no, mismo trato.
  for (const nombre of ['ana', 'no-existe']) {
    for (let i = 1; i <= BLOQUEO.intentos; i++) {
      assert.equal(await minutosBloqueo(q, nombre), 0, `${nombre}: intento ${i} permitido`);
      const recien = await registrarIntento(q, nombre, '10.0.0.1', false);
      assert.equal(recien, i === BLOQUEO.intentos, 'Avisa una sola vez, al bloquearse');
    }
    assert.ok(await minutosBloqueo(q, nombre) > 0, `${nombre}: bloqueada`);
  }
  assert.equal(await minutosBloqueo(q, 'otra'), 0, 'No afecta a otras cuentas');
  // Pasado el plazo se libera.
  await q("UPDATE login_intentos SET ts = ts - interval '16 minutes' WHERE usuario='ana'");
  assert.equal(await minutosBloqueo(q, 'ana'), 0, 'Se libera sola a los 15 minutos');
  // Un ingreso correcto reinicia la cuenta de fallos.
  for (let i = 0; i < 4; i++) await registrarIntento(q, 'ana', '', false);
  await registrarIntento(q, 'ana', '', true);
  await registrarIntento(q, 'ana', '', false);
  assert.equal(await minutosBloqueo(q, 'ana'), 0, 'Los fallos anteriores a un ingreso correcto no suman');
  console.log('✔ IMPAR: sesiones revocables y bloqueo por intentos en PostgreSQL.');
} finally {
  await q(`DROP SCHEMA "${schema}" CASCADE`).catch(() => {});
  await db.end();
}
