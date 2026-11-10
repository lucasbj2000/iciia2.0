/** Campañas IMPAR en PostgreSQL real: permisos, destinatarios, límite diario, pausas, estados y BAJA.
 * Esquema aislado; requiere TEST_DATABASE_URL explícita. Envíos simulados: nunca llama a Meta. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
if (!process.env.TEST_DATABASE_URL) throw Error('Solo para base de pruebas; TEST_DATABASE_URL obligatorio.');
const schema = 'impar_camp_' + randomUUID().replaceAll('-', '');
const admin = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
await admin.connect();
await admin.query(`CREATE SCHEMA "${schema}"`);
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.PGOPTIONS = `-c search_path=${schema},public`;
process.env.PREFIJO_PAIS = '595';
const E = randomUUID(), CANAL = randomUUID(), ADM = randomUUID(), GER = randomUUID(), AG = randomUUID();
const CT1 = randomUUID(), CT2 = randomUUID(), NEG = randomUUID();
let pool;
try {
  await admin.query(`SET search_path TO "${schema}"`);
  await admin.query(`
    CREATE TABLE empresas(id uuid PRIMARY KEY, codigo text);
    CREATE TABLE usuarios(id uuid PRIMARY KEY, empresa_id uuid, nombre text, rol text, sucursal text, activo boolean DEFAULT true, oculto boolean DEFAULT false);
    CREATE TABLE canales(id uuid PRIMARY KEY, empresa_id uuid, nombre text, tipo text, activo boolean, config jsonb DEFAULT '{}');
    CREATE TABLE contactos(id uuid PRIMARY KEY, empresa_id uuid, nombre text, tel text, sucursal text, ciudad text);
    CREATE TABLE negociaciones(id uuid PRIMARY KEY, empresa_id uuid, contacto_id uuid, etapa text, creado timestamptz DEFAULT now());
    CREATE TABLE historial(id bigserial PRIMARY KEY, empresa_id uuid, negociacion_id uuid, txt text, por text, ts timestamptz DEFAULT now());`);
  await admin.query(readFileSync(new URL('../src/migrations/033_campanas_impar.sql', import.meta.url), 'utf8'));
  await admin.query('ALTER TABLE campana_destinos ADD COLUMN IF NOT EXISTS texto TEXT'); // de la 038
  await admin.query("INSERT INTO empresas VALUES($1,'impar')", [E]);
  await admin.query(`INSERT INTO usuarios(id,empresa_id,nombre,rol) VALUES ($1,$4,'Admin','admin'),($2,$4,'Gerente','gerente'),($3,$4,'Agente','agente')`, [ADM, GER, AG, E]);
  await admin.query("INSERT INTO canales VALUES($1,$2,'Verificado','whatsapp_api',true,'{\"phone_number_id\":\"1\"}')", [CANAL, E]);
  await admin.query(`INSERT INTO contactos VALUES ($1,$3,'Ana Sistema','595981000001','Central','Asunción'),($2,$3,'Luis','0981000002','Central','Luque')`, [CT1, CT2, E]);
  await admin.query("INSERT INTO negociaciones(id,empresa_id,contacto_id,etapa) VALUES($1,$2,$3,'nuevo')", [NEG, E, CT1]);

  const C = await import('../src/campanas-impar.mjs');
  ({ pool } = await import('../src/db.mjs'));

  /* Permisos */
  const u = (id, rol) => ({ id, rol });
  assert.equal(await C.tieneAccesoCampanas(u(ADM, 'admin'), E), true);
  assert.equal(await C.tieneAccesoCampanas(u(GER, 'gerente'), E), true, 'gerente por defecto');
  assert.equal(await C.tieneAccesoCampanas(u(AG, 'agente'), E), false, 'agente por defecto no');
  await admin.query('INSERT INTO campanas_accesos(empresa_id,usuario_id,permitido) VALUES($1,$2,false),($1,$3,true)', [E, GER, AG]);
  assert.equal(await C.tieneAccesoCampanas(u(GER, 'gerente'), E), false, 'admin le quitó el acceso al gerente');
  assert.equal(await C.tieneAccesoCampanas(u(AG, 'agente'), E), true, 'admin le dio acceso al agente');
  const permisos = await C.listarPermisos(E);
  assert.deepEqual(permisos.map(p => [p.rol, p.acceso, p.fijo, p.porDefecto]), [['admin', true, true, false], ['gerente', false, false, false], ['agente', true, false, false]]);

  /* Destinatarios: sistema + listado se combinan; bajas e inválidos */
  await admin.query("INSERT INTO campanas_bajas(empresa_id,telefono) VALUES($1,'595981000009')", [E]);
  const prep = await C.prepararDestinos(E, {
    contactos: [CT1, CT2],
    lista: [{ telefono: '0981 000 001', nombre: 'Ana del Excel', datos: { Colegio: 'San José' } },
            { telefono: '0981000003', nombre: 'Nuevo', datos: {} }, { telefono: '0981000009', nombre: 'De baja' }, { telefono: 'xx', nombre: 'Malo' }]
  });
  assert.equal(prep.destinos.length, 4);
  const ana = prep.destinos.find(d => d.telefono === '595981000001');
  assert.equal(ana.nombre, 'Ana Sistema', 'conserva el nombre del sistema');
  assert.equal(ana.contacto_id, CT1);
  assert.deepEqual(ana.datos, { Colegio: 'San José' }, 'las columnas del Excel se suman al contacto del sistema');
  assert.equal(prep.invalidos.length, 1);
  assert.equal(prep.bajas, 1);

  const plantilla = { nombre: 'vuelta', idioma: 'es', nombrado: false, encabezado: null, cuerpo: { texto: 'Hola {{1}}', variables: ['1'] }, pie: '', botones: [] };
  const id = await C.crearCampana({ empresaId: E, usuarioId: ADM, canal: { id: CANAL }, nombre: 'Prueba', plantilla,
    variables: { cuerpo: { 1: { fuente: 'nombre' } } }, limiteDiario: 2, destinos: prep.destinos, deBaja: prep.deBaja });
  let r = await C.resumenCampana(id, E);
  assert.deepEqual([r.total, r.pendientes, r.omitidos, r.estado], [4, 3, 1, 'borrador']);

  /* Motor: borrador no envía; respeta límite diario */
  const enviados = [];
  const enviar = async (camp, d) => { enviados.push(d.telefono); return 'wamid.' + d.telefono; };
  await C.procesarCampanas({ enviar });
  assert.equal(enviados.length, 0, 'un borrador no se envía');
  await admin.query("UPDATE campanas SET estado='enviando',iniciado=now() WHERE id=$1", [id]);
  await C.procesarCampanas({ enviar });
  assert.equal(enviados.length, 2, 'límite diario de 2');
  const textos = (await admin.query("SELECT texto FROM campana_destinos WHERE campana_id=$1 AND texto IS NOT NULL ORDER BY id", [id])).rows.map(x => x.texto);
  assert.ok(textos.length === 2 && textos.every(t => /^Hola \S/.test(t) && !t.includes('{{')), 'Se guarda la plantilla tal como la recibió el cliente');
  await C.procesarCampanas({ enviar });
  r = await C.resumenCampana(id, E);
  assert.equal(enviados.length, 2);
  assert.match(r.error, /Límite diario alcanzado \(2\/2\)/);
  assert.equal(r.estado, 'enviando', 'sigue sola al liberarse el cupo');

  /* Estados de Meta: avanzan, no retroceden */
  const wa = 'wamid.' + enviados[0];
  assert.equal(await C.registrarEstadoCampana(wa, 'read'), true);
  await C.registrarEstadoCampana(wa, 'delivered');
  assert.equal((await admin.query('SELECT estado FROM campana_destinos WHERE wa_id=$1', [wa])).rows[0].estado, 'leido');
  assert.equal(await C.registrarEstadoCampana('wamid.ajeno', 'read'), false, 'acuses ajenos siguen su camino normal');

  /* BAJA del cliente */
  await C.registrarRespuestaCampana({ id: E }, enviados[0], 'Baja', NEG);
  assert.equal((await admin.query('SELECT count(*)::int n FROM campanas_bajas WHERE empresa_id=$1 AND telefono=$2', [E, enviados[0]])).rows[0].n, 1);
  const hist = (await admin.query('SELECT txt FROM historial WHERE negociacion_id=$1 ORDER BY id', [NEG])).rows.map(x => x.txt);
  assert.ok(hist.some(t => t.includes('BAJA')) && hist.some(t => t.includes('«Prueba»')));
  assert.equal((await C.resumenCampana(id, E)).respondieron, 1);

  /* Liberar cupo: falla de pago pausa la campaña sin marcar fallidos */
  await admin.query("UPDATE campana_destinos SET enviado=now()-interval '25 hours' WHERE campana_id=$1 AND enviado IS NOT NULL", [id]);
  await C.procesarCampanas({ enviar: async () => { throw Object.assign(new Error('pago'), { codigo: 131042 }); } });
  r = await C.resumenCampana(id, E);
  assert.equal(r.estado, 'pausada');
  assert.match(r.error, /método de pago/);
  assert.equal(r.fallidos, 0);

  /* Reanudar: un número sin WhatsApp falla solo ese destino y no ocupa cupo */
  await admin.query("UPDATE campanas SET estado='enviando',error=NULL WHERE id=$1", [id]);
  await C.procesarCampanas({ enviar: async () => { throw Object.assign(new Error('x'), { codigo: 131026 }); } });
  r = await C.resumenCampana(id, E);
  assert.equal(r.fallidos, 1);
  assert.equal(r.pendientes, 0);
  assert.equal(await C.enviadosUltimas24h(CANAL), 0, 'los rechazos no cuentan para el tope diario');
  await C.procesarCampanas({ enviar });
  assert.equal((await C.resumenCampana(id, E)).estado, 'terminada');

  /* Canal apagado: pausa con explicación */
  const id2 = await C.crearCampana({ empresaId: E, usuarioId: ADM, canal: { id: CANAL }, nombre: 'Dos', plantilla, variables: {}, limiteDiario: 10,
    destinos: [{ telefono: '595981000004', nombre: 'X', datos: {}, contacto_id: null }], deBaja: new Set() });
  await admin.query("UPDATE canales SET activo=false WHERE id=$1; ", [CANAL]);
  await admin.query("UPDATE campanas SET estado='enviando' WHERE id=$1", [id2]);
  await C.procesarCampanas({ enviar });
  r = await C.resumenCampana(id2, E);
  assert.equal(r.estado, 'pausada');
  assert.match(r.error, /inactivo/);
  console.log('✔ Campañas en PostgreSQL real: permisos, destinatarios combinados, límite diario, pausas, estados y BAJA.');
} finally {
  await pool?.end().catch(() => {});
  await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => {});
  await admin.end();
}
