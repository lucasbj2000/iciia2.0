/** IMPAR · la línea compartida no cambia empleados; dueño editable desde Contactos. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const leer=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=leer('src/migrations/016_canal_principal_impar.sql');
const canal=leer('src/routes/canales.mjs');
const chat=leer('src/conversacion-contacto.mjs');
const cola=leer('src/worker.mjs');
const neg=leer('src/routes/negociaciones.mjs');
const front=leer('public/js/contactos.js');
const admin=leer('public/js/admin.js');
const routes=leer('src/routes/contactos.mjs');

assert.ok(sql.includes("lower(trim(s.nombre))='central'"),'Solo línea de Central');
assert.ok(sql.includes("lower(trim(c.nombre))='principal'"));
assert.ok(sql.includes("'{principal_global}'"),'No modifica credenciales existentes');
assert.ok(!/\bUPDATE\s+(usuarios|contactos|negociaciones)\b/i.test(sql),
  'La habilitación del canal no reasigna personas ni clientes');
assert.ok(canal.includes("r.post('/:id/principal-global', requiere('admin')"));
assert.ok(canal.includes("config,'{}'::jsonb)-'principal_global'"),
  'Un único canal principal puede estar habilitado');
assert.ok(admin.includes('data-principal=') && admin.includes('Principal compartida'));
assert.ok(chat.includes("((ca.config->>'principal_global')='true' OR ("),
  'Agentes de otras sucursales pueden seleccionar principal');
assert.ok(chat.includes("ORDER BY ((ca.config->>'principal_global')='true') DESC"),
  'La compartida aparece primero');
assert.ok(chat.includes("u.sucursal || sucursal"),
  'La negociación pertenece a sucursal del agente, no del teléfono');
assert.ok(cola.includes('m.canal_compartido ? null : m.canal_sucursal'),
  'El teléfono compartido reparte ingresantes sin forzar Central');
assert.ok(neg.includes("((config->>'principal_global')='true') DESC"),
  'Una negociación sin canal usa por defecto el teléfono principal');

assert.ok(routes.includes("r.patch('/:id/responsable',requiere('admin','gerente','jefe')"));
assert.ok(routes.includes('cambiarResponsable(req,req.params.id'));
assert.ok(front.includes('data-cambiar-responsable='));
assert.ok(front.includes("patch(\`/contactos/\${id}/responsable\`"));
assert.ok(front.includes('f-cambiar-responsable'),'Disponible en ficha 360');
assert.ok(front.includes("$$('[data-cambiar-responsable]').forEach"),
  'Todos los botones de listado se enlazan');
assert.ok(front.includes("x.principal_global?'selected':''"),
  'La línea principal está preseleccionada en nuevos chats');

const fuente=leer('src/responsable-contacto-impar.mjs')
  .replace(/^import [^\n]*\n/gm,'').replace(/^export /gm,'');
const empresaId='impar';
const contactoId='11111111-1111-4111-8111-111111111111';
const anteriorId='22222222-2222-4222-8222-222222222222';
const nuevoId='33333333-3333-4333-8333-333333333333';
const cliente={id:contactoId,nombre:'Cliente de ejemplo',sucursal:'Central',responsable_id:anteriorId};
const users=[
  {id:anteriorId,nombre:'Agente anterior',rol:'agente',sucursal:'Central',activo:true,oculto:false,equipo:'jefe.central'},
  {id:nuevoId,nombre:'Nuevo agente',rol:'agente',sucursal:'Ciudad del Este',activo:true,oculto:false,equipo:'jefe.cde'}
];
const activas=['nuevo','contactado','espera'];
const req={empresaId,empresa:{etapas:[...activas.map(id=>({id,activa:true})),{id:'ganado',activa:false}],
  flags:{marcadorTransferido:true}},
  user:{id:'44444444-4444-4444-8444-444444444444',rol:'admin',nombre:'Administrador'}};
const consultas=[];
const c={query:async(sql,params)=>{
  consultas.push({sql,params});
  if(sql.startsWith('SELECT id,nombre,sucursal,responsable_id FROM contactos'))return {rows:[cliente]};
  if(sql.startsWith('SELECT id,nombre,usuario,rol,activo,oculto,sucursal,equipo FROM usuarios'))return {rows:users};
  if(sql.startsWith('SELECT id,marcadores FROM negociaciones'))return {rows:[
    {id:'neg-a',marcadores:[]},{id:'neg-b',marcadores:['frecuente']}
  ]};
  return {rows:[],rowCount:1};
}};
const q=async()=>({rows:users});
const tx=async fn=>fn(c);
const fn=vm.runInNewContext(fuente+';({cambiarResponsable,consultarDestinos})',{q,tx,Set});
const resultado=await fn.cambiarResponsable(req,contactoId,nuevoId);
assert.equal(resultado.movidas,2);
assert.equal(resultado.destino,'Nuevo agente');
assert.equal(consultas.filter(x=>x.sql.startsWith('UPDATE negociaciones')).length,2);
assert.ok(consultas.every(x=>!x.sql.startsWith('DELETE')));
assert.ok(consultas.every(x=>!x.sql.includes('pass_hash')));
assert.ok(consultas.every(x=>!x.sql.includes('UPDATE mensajes')));
const cambios=consultas.filter(x=>x.sql.startsWith('UPDATE negociaciones'));
assert.ok(cambios.every(x=>x.params[3]==='Ciudad del Este'));
assert.ok(consultas.some(x=>x.sql.startsWith('INSERT INTO transferencias')));
assert.ok(consultas.some(x=>x.sql.startsWith('INSERT INTO historial')));
const sel=consultas.find(x=>x.sql.startsWith('SELECT id,marcadores FROM negociaciones'));
assert.deepEqual([...sel.params[2]],activas,
  'Solo se cambian negociaciones abiertas, nunca ganadas/cerradas');
const bajo={...req,user:{id:'id-agente',rol:'agente',nombre:'Agente'}};
await assert.rejects(()=>fn.cambiarResponsable(bajo,contactoId,nuevoId),/permiso/);
const intruso={...req,user:{id:'jefe',rol:'jefe',usuario:'jefe.otro',sucursal:'Otro',nombre:'Jefe'}};
await assert.rejects(()=>fn.cambiarResponsable(intruso,contactoId,nuevoId),/equipo/);
console.log('✔ IMPAR: canal de Central compartido y responsable editable con transferencia segura.');
