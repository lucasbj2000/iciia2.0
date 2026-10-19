/** Prueba de la migración 018 en PostgreSQL real y esquema aislado.
 * Nunca usa la base de producción; requiere TEST_DATABASE_URL explícita.
 */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import vm from 'node:vm';
import pg from 'pg';
import { cambiarTelefonoPrincipal } from '../src/telefonos-impar.mjs';
if(!process.env.TEST_DATABASE_URL)throw Error('Solo para base de pruebas; TEST_DATABASE_URL obligatorio.');
const client=new pg.Client({connectionString:process.env.TEST_DATABASE_URL});
const schema='impar_tel_'+randomUUID().replaceAll('-','');
const sql=readFileSync(new URL('../src/migrations/018_telefonos_contactos_impar.sql',import.meta.url),'utf8');
const E='11111111-1111-4111-8111-111111111111';
const ONE='22222222-2222-4222-8222-222222222222';
const TWO='33333333-3333-4333-8333-333333333333';
const THREE='44444444-4444-4444-8444-444444444444';
await client.connect();
try{
  await client.query('CREATE SCHEMA "'+schema+'"');
  await client.query('SET search_path TO "'+schema+'",public');
  await client.query('CREATE TABLE empresas(id uuid PRIMARY KEY)');
  await client.query('CREATE TABLE contactos(id uuid PRIMARY KEY,empresa_id uuid REFERENCES empresas(id),tel text,tel_norm text)');
  await client.query('CREATE TABLE negociaciones(id uuid PRIMARY KEY,empresa_id uuid,contacto_id uuid,etapa text,creado timestamptz DEFAULT now())');
  await client.query('CREATE TABLE mensajes(id bigserial PRIMARY KEY)');
  await client.query('INSERT INTO empresas(id) VALUES($1)',[E]);
  await client.query(
    'INSERT INTO contactos(id,empresa_id,tel,tel_norm) VALUES '+
    "($1,$4,'595981111111','81111111'),"+
    "($2,$4,'595982222222','82222222'),"+
    "($3,$4,'595982222222','82222222')",
    [ONE,TWO,THREE,E]);
  await client.query('BEGIN');
  await client.query(sql);
  await client.query('COMMIT');
  const x=await client.query('SELECT contacto_id,numero,tel_norm,etiqueta FROM contacto_telefonos');
  assert.equal(x.rowCount,1,'El backfill ignora números duplicados en la base anterior');
  assert.equal(x.rows[0].contacto_id,ONE,'Solo agrega el contacto inequívoco');
  const col=await client.query(
    "SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name='negociaciones' AND column_name='telefono_destino'",
    [schema]);
  assert.equal(col.rowCount,1);
  const remitente=await client.query(
    "SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name='mensajes' AND column_name='remitente_numero'",
    [schema]);
  assert.equal(remitente.rowCount,1);
  await client.query(sql);
  const after=await client.query('SELECT count(*)::int AS n FROM contacto_telefonos');
  assert.equal(after.rows[0].n,1,'La migración puede ejecutarse otra vez sin duplicar datos');
  await client.query("INSERT INTO contacto_telefonos(empresa_id,contacto_id,numero,tel_norm) VALUES($1,$2,'595983333333','83333333')",[E,ONE]);
  await assert.rejects(
    ()=>client.query("INSERT INTO contacto_telefonos(empresa_id,contacto_id,numero,tel_norm) VALUES($1,$2,'595983333333','83333333')",[E,TWO]),
    e=>e.code==='23505','Unique index impide registrar número en dos clientes');
  // Editar principal NO debe crear otro contacto ni borrar los históricos.
  const principal=async()=> (await client.query('SELECT * FROM contactos WHERE id=$1',[ONE])).rows[0];
  const editar=async(numero,conservar)=>{
    await client.query('BEGIN');
    try{
      const c=await principal();
      const resultado=await cambiarTelefonoPrincipal(client,E,c,numero,conservar);
      await client.query('COMMIT');
      return resultado;
    }catch(e){await client.query('ROLLBACK');throw e;}
  };
  const resultado=await editar('595989999999',true);
  assert.equal(resultado.conservado,true);
  assert.equal((await principal()).tel,'595989999999');
  assert.equal((await client.query(
    "SELECT count(*)::int AS n FROM contacto_telefonos WHERE contacto_id=$1 AND tel_norm IN ('81111111','89999999')",
    [ONE])).rows[0].n,2,'El anterior pasa a secundario');
  assert.equal((await client.query('SELECT count(*)::int AS n FROM contactos')).rows[0].n,3,
    'No crea un cuarto cliente al editar un número');
  await assert.rejects(()=>editar('595982222222',true),
    /otro cliente/,'No se puede usar el principal que está repetido en otras fichas');
  assert.equal((await principal()).tel,'595989999999','El conflicto revierte la edición');
  await editar('595983333333',true);
  assert.equal((await principal()).tel,'595983333333',
    'Promociona al principal un número secundario ya vinculado al mismo cliente');
  const {rows:registros}=await client.query(
    'SELECT tel_norm,count(*)::int AS n FROM contacto_telefonos WHERE contacto_id=$1 GROUP BY tel_norm',
    [ONE]);
  assert.ok(registros.every(x=>x.n===1),'No repite números durante promociones');
  await editar('595985555555',false);
  assert.equal((await principal()).tel,'595985555555');
  assert.equal((await client.query(
    "SELECT count(*)::int AS n FROM contacto_telefonos WHERE contacto_id=$1 AND tel_norm='83333333'",
    [ONE])).rows[0].n,0,'Corrige número erróneo sin conservarlo cuando se desmarca');

  // Ejecutar la consulta real del listado Contactos, no una copia escrita a mano.
  await client.query('ALTER TABLE contactos ADD COLUMN nombre text');
  await client.query('ALTER TABLE contactos ADD COLUMN email text');
  await client.query('ALTER TABLE contactos ADD COLUMN direccion text');
  await client.query('ALTER TABLE contactos ADD COLUMN responsable_id uuid');
  await client.query('ALTER TABLE contactos ADD COLUMN creado timestamptz DEFAULT now()');
  await client.query('ALTER TABLE negociaciones ADD COLUMN agente_id uuid');
  await client.query('CREATE TABLE usuarios(id uuid PRIMARY KEY,nombre text)');
  await client.query(
    "UPDATE contactos SET nombre='Cliente Simulado',email='cliente.simulado@ejemplo.test',direccion='Barrio Norte' WHERE id=$1",
    [ONE]);
  const ruta=readFileSync(new URL('../src/routes/contactos.mjs',import.meta.url),'utf8');
  const inicio=ruta.indexOf("r.get('/', requiere(), async (req, res) => {");
  const final=ruta.indexOf("\nr.get('/chequeo'",inicio);
  assert.ok(inicio>=0&&final>inicio);
  let handler;
  vm.runInNewContext(ruta.slice(inicio,final),{
    r:{get:(_path,_middleware,cb)=>{handler=cb;}},
    requiere:()=>()=>{},
    q:(sql,params)=>client.query(sql,params)
  });
  async function encontrar(termino) {
    let filas;
    await handler({
      query:{q:termino},
      empresaId:E,
      user:{rol:'admin',id:ONE},
      empresa:{etapas:[{id:'contactado',activa:true}]}
    },{json:rows=>{filas=rows;}});
    return filas;
  }
  for(const termino of ['cliente simulado','cliente.simulado@ejemplo.test',
    'barrio norte','595985555555','595981111111']){
    const resultados=await encontrar(termino);
    assert.equal(resultados.length,1,'Buscar '+termino+' debe devolver una ficha');
    assert.equal(resultados[0].id,ONE);
  }
  assert.equal((await encontrar('inexistente')).length,0);
  console.log('✓ Búsqueda real por nombre, email, dirección, principal y secundario');

  console.log('✔ PostgreSQL: edición del principal, búsqueda operativa y duplicados bloqueados.');
}finally{
  await client.query('DROP SCHEMA IF EXISTS "'+schema+'" CASCADE').catch(()=>{});
  await client.end();
}
