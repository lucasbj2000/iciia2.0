/** IMPAR · la línea compartida no cambia empleados; dueño editable desde Contactos. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import { elegirPrincipalImpar, consultarPrincipalCentral } from '../src/principal-central-impar.mjs';

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
assert.ok(admin.includes('data-principal=') && admin.includes('Central · principal única'),
  'Administración identifica exactamente la línea oficial de Central');
assert.ok(chat.includes("consultarPrincipalCentral(db,req.empresaId)"),
  'Todos los agentes consultan la línea institucional sin filtros de sucursal');
assert.ok(chat.includes('const canales=[principal]'),
  'En la apertura de chats se ofrece un único número');
assert.ok(chat.includes("u.sucursal || c.sucursal"),
  'El nuevo chat conserva la sucursal del agente y del contacto');
assert.ok(cola.includes('m.canal_compartido ? null : m.canal_sucursal'),
  'El teléfono compartido reparte ingresantes sin forzar Central');
assert.ok(neg.includes("((config->>'principal_global')='true') DESC"),
  'Una negociación sin canal usa por defecto el teléfono principal');

assert.ok(routes.includes("r.patch('/:id/responsable',requiere(),"),'Todos los usuarios pueden tomar o pasar contactos');
assert.ok(routes.includes("r.get('/responsables/disponibles', requiere(),"));
assert.ok(routes.includes("const global = busca.length >= 2 || libres;"),'La búsqueda recorre todos los contactos');
assert.ok(routes.includes("if (libres) cond.push('c.responsable_id IS NULL');"),'Filtro de contactos libres');
assert.ok(front.includes('data-tomar-contacto=') && front.includes("responsableId:S.usuario.id"),'Tomar un contacto libre en un clic');
assert.ok(routes.includes('cambiarResponsable(req,req.params.id'));
assert.ok(front.includes('data-cambiar-responsable='));
assert.ok(front.includes("patch(\`/contactos/\${id}/responsable\`"));
assert.ok(front.includes('f-cambiar-responsable'),'Disponible en ficha 360');
assert.ok(front.includes("$$('[data-cambiar-responsable]').forEach"),
  'Todos los botones de listado se enlazan');
assert.ok(front.includes('type="hidden" id="c-chat-canal"'),
  'La línea Central es la única opción del formulario de conversación');

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
// Agentes y jefes de cualquier equipo pueden pasar el contacto a otro empleado activo.
const agente={...req,user:{id:'id-agente',rol:'agente',nombre:'Agente',activo:true}};
assert.equal((await fn.cambiarResponsable(agente,contactoId,nuevoId)).destino,'Nuevo agente');
const jefeOtro={...req,user:{id:'jefe',rol:'jefe',usuario:'jefe.otro',sucursal:'Otro',nombre:'Jefe',activo:true}};
assert.equal((await fn.cambiarResponsable(jefeOtro,contactoId,nuevoId)).destino,'Nuevo agente');
const inactivo={...req,user:{id:'x',rol:'agente',nombre:'Ex agente',activo:false}};
await assert.rejects(()=>fn.cambiarResponsable(inactivo,contactoId,nuevoId),/permiso/);
// Destino oculto, inactivo o admin: rechazado sin cambios.
for(const malo of [{oculto:true},{activo:false},{rol:'admin'}]){
  const i=users.findIndex(u=>u.id===nuevoId),orig=users[i];users[i]={...orig,...malo};
  await assert.rejects(()=>fn.cambiarResponsable(agente,contactoId,nuevoId),/activo y habilitado/);
  users[i]=orig;
}
// Destinos: todos los empleados activos visibles, con el propio usuario marcado.
const destinos=await fn.consultarDestinos({...agente,user:{...agente.user,id:nuevoId}});
assert.equal(destinos.length,users.length);
assert.equal(destinos.find(d=>d.id===nuevoId).yo,true);

/* El único número activo de IMPAR debe servir para cualquier sucursal,
   aunque el administrador lo haya llamado de otra forma. */
const ejemplo=(id,nombre,sucursal='',config={},activo=true)=>({
  id,nombre,sucursal,config,activo,tipo:'whatsapp_qr',linea:'Única línea'
});
const unico=ejemplo('canal-unico','WhatsApp Central','Central');
const segundo=ejemplo('canal-otro','Sucursal CDE','Ciudad del Este');
assert.equal(elegirPrincipalImpar([unico]).id,'canal-unico');
assert.equal(elegirPrincipalImpar([ejemplo('solo','Número activo sin sucursal')]).id,'solo');
assert.equal(elegirPrincipalImpar([unico,segundo]).id,'canal-unico',
  'Si hay un solo WhatsApp en Central se ofrece a todos, incluso CDE');
assert.equal(elegirPrincipalImpar([segundo,{...unico,config:{principal_global:true}}]).id,'canal-unico');
assert.equal(elegirPrincipalImpar([ejemplo('p','principal','Central'),segundo]).id,'p');
assert.throws(()=>elegirPrincipalImpar([]),/No hay una línea WhatsApp activa/);
assert.throws(()=>elegirPrincipalImpar([unico,ejemplo('otra','Otras','Central')]),/varias líneas/i);
assert.throws(()=>elegirPrincipalImpar([
  {...unico,config:{principal_global:true}},{...segundo,config:{principal_global:true}}
]),/dos canales marcados/i);
const llamadasLinea=[];
const dbLinea={query:async(sql,args)=>{
  llamadasLinea.push({sql,args});
  return {rows:[unico]};
}};
const respuestaLinea=await consultarPrincipalCentral(dbLinea,'empresa-impar');
assert.equal(respuestaLinea.id,'canal-unico');
assert.equal(respuestaLinea.principal_global,true);
assert.deepEqual([...llamadasLinea[0].args],['empresa-impar']);
assert.ok(llamadasLinea[0].sql.includes('ca.empresa_id=$1'),
  'El canal nunca se consulta fuera de IMPAR');
assert.ok(!llamadasLinea[0].sql.includes('u.sucursal') &&
  !llamadasLinea[0].sql.includes('u.linea'),'No restringe canales por preferencias del empleado');
const migracion017=leer('src/migrations/017_activar_whatsapp_unico_impar.sql');
assert.ok(migracion017.includes("config->>'principal_global'='true'"),
  'La migración respeta canales ya marcados');
assert.ok(migracion017.includes('n_total<>1'),
  'No selecciona un WhatsApp arbitrariamente si hay varios');
assert.ok(!/UPDATE\s+(usuarios|contactos|negociaciones)\b/i.test(migracion017));
assert.ok(canal.includes("r.post('/:id/principal-global', requiere('admin')"),
  'Solo el administrador define el canal cuando hay más de uno');
assert.ok(front.includes('type="hidden" id="c-chat-canal"'),
  'El nuevo formulario no necesita elegir línea por sucursal');
assert.ok(!front.includes('<select required id="c-chat-canal"'),
  'El desplegable antiguo no puede reaparecer en la versión nueva');
console.log('✔ IMPAR: canal de Central compartido y responsable editable con transferencia segura.');
