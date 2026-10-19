/** IMPAR: ficha 360 y números múltiples, sin datos personales y sin PostgreSQL real. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const leer=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const servicio=leer('src/telefonos-impar.mjs');
const front=leer('public/js/contactos.js');
const routes=leer('src/routes/contactos.mjs');
const chat=leer('src/conversacion-contacto.mjs');
const send=leer('src/routes/negociaciones.mjs');
const core=leer('src/core.mjs');
const ficha=leer('public/js/ficha.js');
const migra=leer('src/migrations/018_telefonos_contactos_impar.sql');

const modulo=servicio.replace(/^import[^\n]*\n/gm,'').replace(/^export /gm,'');
const fx=vm.runInNewContext(modulo+';({normalizarNumero,agregarTelefono,buscarPorTelefono,telefonosContacto,puedeEditarContacto})',
  {telNorm:tel=>String(tel||'').replace(/\D/g,'').slice(-8)});
const {normalizarNumero,agregarTelefono,buscarPorTelefono,telefonosContacto,puedeEditarContacto}=fx;
assert.deepEqual({...normalizarNumero('0981 234 567')},{numero:'595981234567',clave:'81234567'});
assert.deepEqual({...normalizarNumero('+595 981 234567')},{numero:'595981234567',clave:'81234567'});
assert.throws(()=>normalizarNumero('12345'),/teléfono completo/);
assert.throws(()=>normalizarNumero('0912345'),/teléfono completo/);
const EMP='impar',ONE='cliente-1',TWO='cliente-2';
const primary={id:ONE,tel:'595981111111',tel_norm:'81111111',responsable_id:'agente-1'};
const other={id:TWO,tel:'595982222222',tel_norm:'82222222',responsable_id:'agente-2'};
const linked=new Map();
const rows={};
const consultas=[];
const db={query:async(sql,params)=>{
 consultas.push({sql,params});
 if(sql.includes('pg_advisory_xact_lock'))return {rows:[]};
 if(sql.includes('SELECT id FROM contactos WHERE empresa_id'))
   return {rows:[primary,other].filter(x=>x.tel_norm===params[1]).map(x=>({id:x.id}))};
 if(sql.startsWith('SELECT contacto_id FROM contacto_telefonos'))
   return {rows:linked.has(params[1])?[{contacto_id:linked.get(params[1]).contacto_id}]:[]};
 if(sql.startsWith('INSERT INTO contacto_telefonos')){
   const [empresa_id,contacto_id,numero,tel_norm,etiqueta]=params;
   if(linked.has(tel_norm))throw Error('duplicate');
   const r={id:'tel-'+tel_norm,numero,tel_norm,etiqueta,contacto_id};
   linked.set(tel_norm,r);return {rows:[r]};
 }
 if(sql.startsWith('SELECT id,numero,tel_norm,etiqueta FROM contacto_telefonos'))
   return {rows:[...linked.values()].filter(x=>x.contacto_id===params[1])};
 if(sql.startsWith('SELECT tel,tel_norm FROM contactos'))
   return {rows:[{tel:primary.tel,tel_norm:primary.tel_norm}]};
 if(sql.startsWith('SELECT DISTINCT c.* FROM contactos')){
   const c=[primary,other].filter(x=>x.tel_norm===params[1]||
     [...linked.values()].some(t=>t.contacto_id===x.id&&t.tel_norm===params[1]));
   return {rows:c.slice(0,2)};
 }
 throw Error('Unexpected SQL: '+sql);
}};
const agregado=await agregarTelefono(db,EMP,ONE,'595983333333','Trabajo');
assert.equal(agregado.etiqueta,'Trabajo');
assert.equal(agregado.contacto_id,ONE);
assert.equal((await buscarPorTelefono(db,EMP,'595983333333')).id,ONE);
assert.equal((await buscarPorTelefono(db,EMP,'595981111111')).id,ONE);
assert.equal((await telefonosContacto(db,EMP,ONE)).length,2);
await assert.rejects(()=>agregarTelefono(db,EMP,TWO,'595983333333'),/otro cliente/);
await assert.rejects(()=>agregarTelefono(db,EMP,ONE,other.tel),/otro cliente/);
await assert.rejects(()=>agregarTelefono(db,EMP,ONE,primary.tel),/principal/);
await assert.rejects(()=>agregarTelefono(db,EMP,ONE,'595983333333'),/ya tiene/);
assert.ok(consultas.some(c=>c.sql.includes('pg_advisory_xact_lock')),'Protección de concurrencia');

assert.equal(puedeEditarContacto({id:'agente-1',rol:'agente'},primary,[]),true);
assert.equal(puedeEditarContacto({id:'agente-2',rol:'agente'},primary,[]),false);
assert.equal(puedeEditarContacto({id:'agente-2',rol:'agente'},primary,[{agente_id:'agente-2'}]),true);
assert.equal(puedeEditarContacto({id:'gerente',rol:'gerente'},primary,[]),true);
assert.ok(routes.includes("r.post('/:id/telefonos', requiere()"));
assert.ok(routes.includes("r.delete('/:id/telefonos/:telefonoId', requiere()"));
assert.ok(routes.includes('await editarPermitido(db,req,rows[0])'));
assert.ok(routes.includes('const editable=await editarPermitido('));
assert.ok(routes.includes("if (!await editarPermitido(db,req,c))"));
assert.ok(routes.includes('b.tel=normalizarNumero(b.tel).numero'));
assert.ok(routes.includes('buscarPorTelefono({query:q},req.empresaId,b.tel)'));
assert.ok(routes.includes('Este número ya está registrado en IMPAR'));
assert.ok(front.includes('AbortSignal.timeout(16000)'));
assert.ok(front.includes('No se pudo cargar la ficha 360°'));
assert.ok(front.includes('f-reintentar'));
assert.ok(front.includes('c.editable'));
assert.ok(front.includes('f-telefono-adicional'));
assert.ok(front.includes('data-eliminar-telefono'));
assert.ok(front.includes('c-chat-numero'));
assert.ok(chat.includes('telefono_destino'));
assert.ok(send.includes('n.telefono_destino || c.externos?.whatsapp || c.tel'));
assert.ok(send.includes("r.patch('/:id/telefono-destino'"));
assert.ok(ficha.includes('f-telefono-chat'));
assert.ok(core.includes('buscarPorTelefono({query:q},empresa.id'));
assert.ok(core.includes('pg_advisory_xact_lock(hashtext($1))'));
assert.ok(migra.includes('CREATE UNIQUE INDEX IF NOT EXISTS uq_impar_telefono_secundario'));
assert.ok(migra.includes('telefono_destino TEXT'));
assert.ok(migra.includes('count(*) FROM contactos o'),'La migración no fusiona colisiones anteriores');
assert.ok(!/DELETE\s+FROM\s+contactos/i.test(migra));
console.log('✔ IMPAR: ficha 360 estable, edición autorizada, multiteléfono y antduplicados.');
