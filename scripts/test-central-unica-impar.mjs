/** IMPAR · una sola línea de Central para todos los empleados y clientes registrados. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const leer=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const principal=leer('src/principal-central-impar.mjs');
const conversacion=leer('src/conversacion-contacto.mjs');
const ruta=leer('src/routes/contactos.mjs');
const front=leer('public/js/contactos.js');
const canal=leer('src/routes/canales.mjs');
const worker=leer('src/worker.mjs');
const admin=leer('public/js/admin.js');

const idCentral='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const idContacto='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const idAgente='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const idOtro='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const idNeg='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

const fuentePrincipal=principal.replace(/^export /gm,'');
const consultar=vm.runInNewContext(fuentePrincipal+';consultarPrincipalCentral');
const consulta=async(sql,args)=> {
  assert.ok(sql.includes("ca.tipo IN ('whatsapp_qr','whatsapp_api')"));
  assert.ok(sql.includes('LEFT JOIN sucursales sc'));
  assert.ok(sql.includes('ca.empresa_id=$1'));
  assert.ok(sql.includes('ca.activo=TRUE'));
  assert.ok(!sql.includes('u.sucursal')&&!sql.includes("ca.config->>'principal_global'"));
  assert.equal(args[0],'empresa-impar');
  return {rows:[{id:idCentral,nombre:'principal',linea:'',sucursal:'Central',activo:true,tipo:'whatsapp_qr',config:{}}]};
};
const canalVisible=await consultar({query:consulta},'empresa-impar');
assert.equal(canalVisible.id,idCentral);
assert.equal(canalVisible.principal_global,true);
await assert.rejects(
  ()=>consultar({query:async()=>({rows:[]})},'empresa-impar'),
  /No hay una línea WhatsApp activa/
);
await assert.rejects(
  ()=>consultar({query:async()=>({rows:[{...canalVisible,activo:true,tipo:'whatsapp_qr',config:{}},{...canalVisible,activo:true,tipo:'whatsapp_qr',config:{}}]})},'empresa-impar'),
  /más de una línea/
);

const cliente={id:idContacto,nombre:'Cliente de ejemplo',tel:'595981000001',
  responsable_id:idOtro,sucursal:'Encarnación',linea:'Agencia'};
const eventos=[];
let hayAbierta=false;
const db={query:async(sql,args)=>{
  eventos.push({sql,args});
  if(sql.startsWith('SELECT * FROM contactos'))return {rows:[cliente]};
  if(sql.includes('FROM negociaciones n LEFT JOIN usuarios'))
    return {rows:hayAbierta?[{id:idNeg,etapa:'contactado',agente_id:idOtro,
      sucursal:'Encarnación',linea:'Otra',responsable:'Responsable existente'}]:[]};
  if(sql.includes('JOIN sucursales sc'))return consulta(sql,args);
  if(sql.startsWith('INSERT INTO negociaciones'))return {rows:[{id:idNeg}]};
  return {rows:[],rowCount:1};
}};
const tx=async f=>f(db);
const fuenteConversacion=conversacion
  .replace(/^import[^\n]*\n/gm,'').replace(/^export /gm,'');
const fn=vm.runInNewContext(fuenteConversacion+';conversacionContacto',
  {tx,consultarPrincipalCentral:consultar,
    telefonosContacto:async()=>[{id:'telefono-principal',numero:cliente.tel,
      tel_norm:cliente.tel.slice(-8),etiqueta:'Principal'}],
    normalizarNumero:valor=>({numero:String(valor),clave:String(valor).slice(-8)})});
const req={empresaId:'empresa-impar',
  user:{id:idAgente,usuario:'agente.otro',nombre:'Empleado de CDE',rol:'agente',
    sucursal:'Ciudad del Este',linea:'CDE'},
  empresa:{etapas:[{id:'contactado',activa:true},{id:'ganado',activa:false}]}};

const preview=await fn(req,idContacto);
assert.equal(preview.canales.length,1,'Un único canal para iniciar conversación');
assert.equal(preview.canales[0].id,idCentral);
assert.equal(preview.tel,cliente.tel);
assert.ok(eventos.every(e=>e.sql.trim().startsWith('SELECT')),'Vista previa sin escrituras');
eventos.length=0;
await assert.rejects(
  ()=>fn(req,idContacto,{texto:'Hola',canalId:idOtro}),
  /debe iniciarse desde la línea principal/
);
assert.ok(!eventos.some(e=>e.sql.includes('INSERT INTO')));
eventos.length=0;
const resultado=await fn(req,idContacto,{texto:'Mensaje de prueba',canalId:idCentral});
assert.equal(resultado.creada,true);
const nuevo=eventos.find(e=>e.sql.startsWith('INSERT INTO negociaciones'));
assert.equal(nuevo.args[3],idCentral);
assert.equal(nuevo.args[4],idAgente);
assert.equal(nuevo.args[5],'Ciudad del Este',
  'La línea compartida no cambia la sucursal del agente');
assert.equal(nuevo.args[6],'CDE','Conserva línea organizativa del agente');
const out=eventos.find(e=>e.sql.startsWith('INSERT INTO outbox'));
assert.equal(out.args[1],idCentral);
assert.equal(out.args[3],'595981000001');
assert.ok(!eventos.some(e=>e.sql.startsWith('DELETE')));
assert.ok(!eventos.some(e=>e.sql.includes('UPDATE canales')));
eventos.length=0;
hayAbierta=true;
const activa=await fn(req,idContacto,{texto:'No duplicar',canalId:idCentral});
assert.equal(activa.activa,true);
assert.equal(activa.propia,false);
assert.equal(activa.responsable,'Responsable existente');
assert.ok(eventos.every(e=>e.sql.trim().startsWith('SELECT')),
  'Una negociación abierta de otro empleado no se duplica');

assert.ok(ruta.includes("r.get('/buscar/registrado', requiere()"));
assert.ok(ruta.includes('WHERE c.empresa_id=$1'));
assert.ok(ruta.includes('strpos(lower(c.nombre),$2)>0'));
assert.ok(ruta.includes('LIMIT 25'));
assert.ok(front.includes('Buscar registrado en IMPAR'));
assert.ok(front.includes("get('/contactos/buscar/registrado?q='"));
assert.ok(front.includes('type="hidden" id="c-chat-canal"'));
assert.ok(!front.includes('$$$('),'No hay selectores indefinidos que rompan el formulario');
assert.ok(front.includes("$$('[data-abrir-impar]').forEach"));
assert.ok(front.includes("$$('[data-cerrar]').forEach"));
assert.ok(worker.includes("lower(trim(c.nombre))='principal' AND lower(trim(s.nombre))='central'"),
  'La misma línea se trata como compartida al recibir mensajes');
assert.ok(admin.includes('La línea <b>Central → principal</b>'));
assert.ok(canal.includes("r.post('/:id/principal-global', requiere('admin')") && canal.includes('canal.activo'),
  'Solo el administrador puede definir un WhatsApp activo como institucional');
console.log('✔ IMPAR: un solo canal Central para todos, búsqueda global y sin duplicar negociaciones.');
