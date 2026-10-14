/** IMPAR - pruebas de eliminación con transferencia sin tocar la base real. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const leer=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const backend=leer('src/eliminar-usuario-impar.mjs');
const route=leer('src/routes/organigrama.mjs');
const gui=leer('public/js/organigrama.js');
const admin=leer('public/js/admin.js');

const empresa='impar-id';
const origen={id:'viejo-id',nombre:'Usuario de ejemplo',usuario:'empleado.antiguo',
  rol:'jefe',activo:true,oculto:false,superior_id:null};
const destino={id:'original-id',nombre:'Empleado original',usuario:'empleado.original',
  rol:'jefe',activo:true,oculto:false,superior_id:null,sucursal:'Casa central'};
const adminId='admin-id';
const acciones=[];
let modoDescendiente=false;
const db={query:async(sql,params)=>{
  acciones.push({sql,params});
  if(sql.includes('SELECT id,nombre,usuario,rol,superior_id,equipo,activo,oculto FROM usuarios')){
    const d={...destino,superior_id:modoDescendiente?origen.id:null};
    return {rows:[origen,d],rowCount:2};
  }
  return {rows:[],rowCount:1};
}};
const q=async(sql,args)=>{
  acciones.push({sql,args});
  if(sql.includes('FROM usuarios WHERE empresa_id=$1 AND NOT oculto'))
    return {rows:[origen,destino]};
  return {rows:[{clientes:3,negociaciones:2,subordinados:0,tareas:1,sucursales:0,solicitudes:0}]};
};
const tx=fn=>fn(db);
const codigo=backend.replace(/^import [^\n]+\n/gm,'').replace(/^export /gm,'');
const funciones=vm.runInNewContext(codigo+
  ';({validarSeleccion,vistaPreviaTransferencia,eliminarConTransferencia})',{q,tx});
const {validarSeleccion,vistaPreviaTransferencia,eliminarConTransferencia}=funciones;

assert.equal(validarSeleccion(origen,destino,adminId),true);
assert.throws(()=>validarSeleccion({...origen,rol:'admin'},destino,adminId));
assert.throws(()=>validarSeleccion(origen,{...destino,activo:false},adminId));
assert.throws(()=>validarSeleccion(origen,{...destino,id:origen.id},adminId));
assert.throws(()=>validarSeleccion({...origen,id:adminId},destino,adminId));

const anterior=acciones.length;
const preview=await vistaPreviaTransferencia(empresa,origen.id,adminId);
assert.equal(preview.resumen.clientes,3);
assert.equal(preview.candidatos.length,1);
assert.equal(preview.candidatos[0].id,destino.id);
assert.ok(acciones.slice(anterior).every(x=>x.sql.trimStart().startsWith('SELECT')));
console.log('✓ Vista previa sin modificar usuarios ni clientes');

acciones.length=0;
const resultado=await eliminarConTransferencia(empresa,origen.id,destino.id,adminId);
assert.equal(resultado.destino.usuario,destino.usuario);
assert.ok(acciones.some(x=>x.sql.includes('UPDATE contactos SET responsable_id=$3')));
assert.ok(acciones.some(x=>x.sql.includes('UPDATE negociaciones SET agente_id=$3')));
assert.ok(acciones.some(x=>x.sql.includes('UPDATE sucursales SET responsable_id=$3')));
assert.ok(acciones.some(x=>x.sql.includes('UPDATE proyecto_pasos SET responsable_id=$3')));
assert.ok(acciones.some(x=>x.sql.includes('UPDATE usuarios SET superior_id=$3')));
assert.ok(acciones.some(x=>x.sql.includes('UPDATE grupos g SET miembros=')));
assert.ok(acciones.some(x=>x.sql.includes('UPDATE notificaciones SET usuario_id=$3')));
assert.ok(acciones.some(x=>x.sql.includes('UPDATE notas_internas n SET menciones=')));
assert.ok(acciones.some(x=>x.sql.includes('activo=FALSE,oculto=TRUE')));
assert.ok(acciones.every(x=>!/\bDELETE\s+FROM\b/i.test(x.sql)));
assert.ok(acciones.every(x=>!x.sql.includes('pass_hash')));
assert.ok(acciones.every(x=>!x.sql.includes('UPDATE mensajes SET autor_id')));
console.log('✓ Transfiere cartera, tareas y jerarquías preservando acceso e historia del destinatario');

acciones.length=0;
modoDescendiente=true;
await eliminarConTransferencia(empresa,origen.id,destino.id,adminId);
assert.ok(acciones.some(x=>x.sql.includes('UPDATE usuarios SET superior_id=$3,equipo=$4')),
  'Al ascender un subordinado se impiden ciclos');
console.log('✓ Destinatario subordinado se asciende sin crear círculos');

assert.ok(route.includes("r.get('/empleados/:id/transferencia',requiere('admin')"));
assert.ok(route.includes("r.post('/empleados/:id/eliminar',requiere('admin')"));
assert.ok(route.includes("'TRANSFERIR_Y_ELIMINAR'"));
assert.ok(gui.includes('id="org-delete"'));
assert.ok(gui.includes('org-transfer-destino'));
assert.ok(gui.includes("post('/organigrama/empleados/'"));
assert.ok(gui.includes("$$('[data-cerrar]').forEach"));
assert.ok(admin.includes('data-usr-eliminar'));
assert.ok(admin.includes("$$('[data-usr-eliminar]').forEach"));
console.log('✔ IMPAR: eliminación y transferencia administrada validadas.');
