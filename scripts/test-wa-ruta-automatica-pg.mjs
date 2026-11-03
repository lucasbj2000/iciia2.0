/** IMPAR · ruta WhatsApp automática (número/LID) contra PostgreSQL real, esquema aislado.
 * Nunca usa la base de producción; requiere TEST_DATABASE_URL explícita. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
if (!process.env.TEST_DATABASE_URL) throw Error('Solo para base de pruebas; TEST_DATABASE_URL obligatorio.');
const schema = 'impar_ruta_' + randomUUID().replaceAll('-', '');
const admin = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
const leer = f => readFileSync(new URL('../src/migrations/' + f, import.meta.url), 'utf8');
const E = '11111111-1111-4111-8111-111111111111', C = '22222222-2222-4222-8222-222222222222';
const pn = '595981000001@s.whatsapp.net', lid = '123456789012345@lid';
await admin.connect();
let cerrarPool = async () => {};
try {
  await admin.query(`CREATE SCHEMA "${schema}"`);
  await admin.query(`SET search_path TO "${schema}",public`);
  await admin.query('CREATE TABLE empresas(id uuid PRIMARY KEY)');
  await admin.query("CREATE TABLE canales(id uuid PRIMARY KEY, tipo text DEFAULT 'whatsapp_qr', activo boolean DEFAULT true)");
  await admin.query(`CREATE TABLE mensajes(id bigserial PRIMARY KEY, empresa_id uuid, negociacion_id uuid, dir text, txt text, autor_id uuid,
    estado text, archivo_id uuid, media_url text, media_tipo text, media_nombre text, media_bytes bigint)`);
  await admin.query(`CREATE TABLE outbox(id bigserial PRIMARY KEY, empresa_id uuid, canal_id uuid, negociacion_id uuid, destino text, txt text,
    archivo_id uuid, media_url text, media_tipo text, media_nombre text, estado text DEFAULT 'pendiente')`);
  await admin.query("CREATE TABLE usuarios(id uuid PRIMARY KEY, empresa_id uuid, rol text, activo boolean DEFAULT true)");
  await admin.query(`CREATE TABLE notificaciones(id bigserial PRIMARY KEY, empresa_id uuid, usuario_id uuid, tipo text, titulo text, msg text, tono text, ref uuid)`);
  await admin.query('CREATE TABLE historial(id bigserial PRIMARY KEY, empresa_id uuid, negociacion_id uuid, txt text, por text, ts timestamptz DEFAULT now())');
  await admin.query('INSERT INTO empresas VALUES ($1)', [E]);
  await admin.query('INSERT INTO canales(id) VALUES ($1)', [C]);
  await admin.query("INSERT INTO usuarios VALUES ($1,$2,'admin',true)", [randomUUID(), E]);
  await admin.query(leer('020_wa_entregas_impar.sql'));
  await admin.query(leer('021_wa_identidades_impar.sql'));
  // Una elección LID manual previa debe conservarse al migrar.
  await admin.query('INSERT INTO wa_identidades_impar(empresa_id,canal_id,pn_jid,lid_jid,preferir_lid) VALUES($1,$2,$3,$4,true)',
    [E, C, '595981000009@s.whatsapp.net', '999999999999999@lid']);
  for (let i = 0; i < 2; i++) {  // idempotentes
    await admin.query(leer('030_wa_ruta_automatica_impar.sql'));
    await admin.query(leer('031_wa_rescate_automatico_impar.sql'));
  }
  assert.equal((await admin.query("SELECT ruta FROM wa_identidades_impar WHERE pn_jid='595981000009@s.whatsapp.net'")).rows[0].ruta, 'lid');

  // El módulo usa el pool de db.mjs: apuntarlo al esquema aislado.
  const url = new URL(process.env.TEST_DATABASE_URL);
  url.searchParams.set('options', `-c search_path=${schema},public`);
  process.env.DATABASE_URL = url.toString();
  const db = await import('../src/db.mjs');
  cerrarPool = () => db.pool.end();
  const id = await import('../src/wa-identidades-impar.mjs');
  const canal = { id: C, empresa_id: E };

  assert.equal((await id.rutaParaEnvioWA(canal, pn)).destino, pn, 'Sin equivalencia: número');
  await id.registrarParejaWA(canal, { pn, lid }, 'mensaje_entrante', 'pn');
  assert.equal((await id.rutaParaEnvioWA(canal, pn)).destino, pn, 'El cliente escribe desde su número');
  await id.registrarModoEntranteWA(canal, { remoteJid: '123456789012345:7@lid' });
  assert.equal((await id.rutaParaEnvioWA(canal, pn)).destino, lid, 'El cliente pasó a escribir por LID');

  // Aviso de «no pude descifrar» de un mensaje enviado por LID → vuelve al número.
  await admin.query("INSERT INTO wa_entregas_impar(canal_id,empresa_id,wa_id,ack,jid_tipo) VALUES($1,$2,'MSG1',3,'lid')", [C, E]);
  const r = await id.registrarReintentoWA(canal, { from: '123456789012345:7@lid', id: 'MSG1', type: 'retry' });
  assert.equal(r.tipo, 'lid'); assert.equal(r.contacto, true);
  assert.equal((await admin.query("SELECT reintentos FROM wa_entregas_impar WHERE wa_id='MSG1'")).rows[0].reintentos, 1);
  assert.equal((await id.rutaParaEnvioWA(canal, pn)).destino, pn, 'Falló LID: próximos envíos al número');
  assert.equal((await id.rutaParaEnvioWA(canal, pn)).motivo, 'fallo_lid');
  // Dos fallos del número (como en el caso real) → LID.
  await id.registrarReintentoWA(canal, { from: '595981000001:3@s.whatsapp.net', id: 'X', type: 'retry' });
  await id.registrarReintentoWA(canal, { from: '595981000001@s.whatsapp.net', id: 'Y', type: 'retry' });
  assert.equal((await id.rutaParaEnvioWA(canal, pn)).destino, lid, 'Falló el número más veces: LID');
  // Un mensaje leído por LID confirma esa ruta.
  assert.equal(await id.confirmarRutaWA(canal, lid), true);
  assert.equal((await admin.query('SELECT fallos_lid FROM wa_identidades_impar WHERE pn_jid=$1', [pn])).rows[0].fallos_lid, 0);

  // Elección fija del admin y regreso a automática.
  assert.equal(await id.elegirRutaWA(E, C, pn, 'pn'), true);
  assert.equal((await id.rutaParaEnvioWA(canal, pn)).destino, pn);
  const est = await id.estadoRutaWA(E, C, pn);
  assert.equal(est.ruta, 'pn'); assert.equal(est.motivo, 'manual');
  assert.equal(await id.elegirRutaWA(E, C, pn, 'auto'), true);
  assert.equal((await admin.query('SELECT fallos_pn FROM wa_identidades_impar WHERE pn_jid=$1', [pn])).rows[0].fallos_pn, 0, 'Volver a automática limpia fallos');

  // WhatsApp informa otro LID: vuelve a automática y olvida fallos y elecciones.
  await id.elegirRutaWA(E, C, pn, 'lid');
  await id.registrarParejaWA(canal, { pn, lid: '555555555555555@lid' }, 'mensaje_entrante', null);
  const f = (await admin.query('SELECT ruta,modo_entrante FROM wa_identidades_impar WHERE pn_jid=$1', [pn])).rows[0];
  assert.equal(f.ruta, 'auto'); assert.equal(f.modo_entrante, 'lid', 'Conserva el último modo conocido');
  // Aislamiento por canal.
  assert.equal((await id.rutaParaEnvioWA({ id: randomUUID(), empresa_id: E }, pn)).destino, pn);
  await assert.rejects(admin.query("UPDATE wa_identidades_impar SET ruta='otra'"), /check/i);

  // ---- Rescate automático, sin intervención humana ----
  const { rescatarNoDescifrados } = await import('../src/rescate-no-descifrados-impar.mjs');
  const N = randomUUID();
  await id.elegirRutaWA(E, C, pn, 'auto');
  await admin.query("UPDATE wa_identidades_impar SET lid_jid=$2,modo_entrante='pn',fallos_pn=0,fallos_lid=0 WHERE pn_jid=$1", [pn, lid]);
  const msg = (await admin.query("INSERT INTO mensajes(empresa_id,negociacion_id,dir,txt,estado) VALUES($1,$2,'out','Pedido listo','enviado') RETURNING id", [E, N])).rows[0].id;
  const ob = (await admin.query("INSERT INTO outbox(empresa_id,canal_id,negociacion_id,destino,txt,mensaje_id,estado) VALUES($1,$2,$3,'595981000001','Pedido listo',$4,'enviado') RETURNING id", [E, C, N, msg])).rows[0].id;
  await admin.query("INSERT INTO wa_entregas_impar(canal_id,empresa_id,wa_id,outbox_id,ack,jid_tipo) VALUES($1,$2,'RESC1',$3,3,'pn')", [C, E, ob]);
  await id.registrarReintentoWA(canal, { from: '595981000001:2@s.whatsapp.net', id: 'RESC1', type: 'retry' });
  let res = await rescatarNoDescifrados();
  assert.equal(res.reenviados, 0, 'Un solo aviso reciente: primero deja actuar al reintento de WhatsApp');
  await id.registrarReintentoWA(canal, { from: '595981000001:2@s.whatsapp.net', id: 'RESC1', type: 'retry' });
  const [a, b] = await Promise.all([rescatarNoDescifrados(), rescatarNoDescifrados()]);
  assert.equal(a.reenviados + b.reenviados, 1, 'Segundo aviso: se reenvía solo, una única vez');
  const copia = (await admin.query('SELECT * FROM outbox WHERE reenvio_de=$1', [ob])).rows;
  assert.equal(copia.length, 1); assert.equal(copia[0].txt, 'Pedido listo'); assert.equal(copia[0].estado, 'pendiente');
  assert.equal((await id.rutaParaEnvioWA(canal, pn)).destino, lid, 'La copia saldrá por LID');
  assert.equal((await admin.query("SELECT rescate FROM wa_entregas_impar WHERE wa_id='RESC1'")).rows[0].rescate, 'reenviado');
  assert.ok((await admin.query('SELECT 1 FROM historial WHERE negociacion_id=$1', [N])).rowCount, 'Queda en el historial');
  assert.equal((await rescatarNoDescifrados()).reenviados, 0, 'No vuelve a reenviar');
  // Si la copia tampoco se puede leer: no rebota, avisa a administración.
  await admin.query("INSERT INTO wa_entregas_impar(canal_id,empresa_id,wa_id,outbox_id,ack,jid_tipo) VALUES($1,$2,'RESC2',$3,3,'lid')", [C, E, copia[0].id]);
  await id.registrarReintentoWA(canal, { from: lid, id: 'RESC2', type: 'retry' });
  await id.registrarReintentoWA(canal, { from: lid, id: 'RESC2', type: 'retry' });
  res = await rescatarNoDescifrados();
  assert.equal(res.reenviados, 0); assert.equal(res.agotados, 1, 'Un reenvío nunca se reenvía');
  assert.equal((await admin.query("SELECT COUNT(*)::int AS n FROM notificaciones WHERE tipo='whatsapp_entrega'")).rows[0].n, 1, 'Administración avisada una vez');
  assert.equal((await rescatarNoDescifrados()).agotados, 0, 'Sin avisos repetidos');
  // Leído después del aviso: se descifró, no se reenvía.
  await admin.query("INSERT INTO wa_entregas_impar(canal_id,empresa_id,wa_id,outbox_id,ack,jid_tipo,reintentos,reintento_ts,leido_ts) VALUES($1,$2,'RESC3',$3,4,'pn',3,now()-interval '10 minutes',now())", [C, E, ob]);
  assert.equal((await rescatarNoDescifrados()).revisados, 0, 'Mensaje leído tras el aviso no se revisa');
  console.log('✔ Ruta WhatsApp automática y rescate sin intervención validados en PostgreSQL real.');
} finally {
  await cerrarPool().catch(() => {});
  await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => {});
  await admin.end();
}
