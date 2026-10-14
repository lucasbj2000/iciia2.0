/** Tests de conciliación Bitrix sin información real de clientes. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { claveNombre,claveTelefono,prepararFila,analizarCargaBitrix } from '../src/importar-bitrix-seguro.mjs';
const empresa='10000000-0000-0000-0000-000000000001';
const agente='20000000-0000-0000-0000-000000000001';
const testInput=(nombre,telefono,owner='Agente De Prueba',apellido='')=>({
  nombre,telefono,responsable:owner,apellido
});
const DB={
  usuarios:[{id:agente,nombre:'Agente de Prueba',rol:'agente',sucursal:'Central',linea:'Ventas'}],
  contactos:[{id:'30000000-0000-0000-0000-000000000001',nombre:'Cliente Existente',
    tel:'595981111111',tel_norm:'81111111',externos:{}}]
};
const fake={
  async query(sql){
    if(sql.includes('FROM usuarios'))return {rows:DB.usuarios};
    if(sql.includes('FROM contactos'))return {rows:DB.contactos};
    throw new Error('Consulta inesperada en prueba: '+sql);
  }
};
assert.equal(claveTelefono('+595 981 111 111'),'81111111');
assert.equal(claveNombre('PéPE   Pérez'),'pepe perez');
assert.equal(prepararFila(testInput('Marta López','595982123456','Agente de Prueba','López'),2).nombre,'Marta López');

const raw=[
  testInput('Persona Nueva','595983333333'),
  testInput('Nombre cambiado','595981111111'),
  testInput('Cliente Existente','595984444444'),
  testInput('Fila Duplicada A','595985555555'),
  testInput('Fila Duplicada B','595985555555'),
  testInput('5,95986E+11','595986666666'),
  testInput('Persona Sin Responsable','595987777777','Agente Desconocido')
];
const resultado=await analizarCargaBitrix(fake,empresa,{filas:raw,asignaciones:{}});
assert.deepEqual(resultado.resumen,{
  recibidos:7,nuevos:1,existentes:1,conflictosArchivo:2,
  nombresRevisar:1,invalidos:1,sinResponsable:1
});
assert.equal(resultado.lista[0].responsableId,agente);
assert.equal(resultado.lista[1].estado,'existente');
assert.equal(resultado.lista[2].estado,'revision_nombre');
assert.equal(resultado.lista[3].estado,'conflicto_archivo');
assert.equal(resultado.lista[4].estado,'conflicto_archivo');
assert.equal(resultado.lista[5].estado,'invalido');
assert.equal(resultado.lista[6].estado,'sin_responsable');

const o=await analizarCargaBitrix(fake,empresa,{
  filas:[testInput('Nuevo sin asignar','595983333333')],
  asignaciones:{'Agente De Prueba':''}
});
assert.equal(o.resumen.nuevos,0);
assert.equal(o.resumen.sinResponsable,1);

const asignado=await analizarCargaBitrix(fake,empresa,{
  filas:[testInput('Nuevo con asignación','595983333333','Bot Comercial')],
  asignaciones:{'Bot Comercial':agente}
});
assert.equal(asignado.resumen.nuevos,1);
assert.equal(asignado.lista[0].responsableId,agente);
const copia=await analizarCargaBitrix(fake,empresa,{
  filas:[testInput('Nuevo con asignación','595983333333','Bot Comercial')],
  asignaciones:{'Bot Comercial':agente}
});
assert.equal(asignado.firma,copia.firma);
DB.contactos.push({id:'30000000-0000-0000-0000-000000000002',nombre:'Nuevo con asignación',
  tel:'595983333333',tel_norm:'83333333',externos:{}});
const trasInsertar=await analizarCargaBitrix(fake,empresa,{
  filas:[testInput('Nuevo con asignación','595983333333','Bot Comercial')],
  asignaciones:{'Bot Comercial':agente}
});
assert.equal(trasInsertar.resumen.existentes,1);

assert.notEqual(asignado.firma,trasInsertar.firma,'Cambia la firma al modificarse la base');
const route=readFileSync(new URL('../src/routes/importar-bitrix.mjs',import.meta.url),'utf8');
const server=readFileSync(new URL('../src/server.mjs',import.meta.url),'utf8');
const admin=readFileSync(new URL('../public/js/admin.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
assert.ok(route.includes("r.use(requiere('admin'))"),'Solo administradores acceden al importador');
assert.ok(route.includes('pg_advisory_xact_lock'),'Debe estar serializado');
assert.ok(route.includes('plan.firma!==body.firma'),'Debe verificar firma antes de escribir');
assert.ok(route.includes('WHERE NOT EXISTS'),'Debe comprobar duplicados al insertar');
assert.ok(!/UPDATE\s+contactos|DELETE\s+FROM\s+contactos/i.test(route),'Nunca modifica ni elimina contactos previos');
assert.ok(server.includes("app.use('/api/bitrix', rBitrix)"));
assert.ok(admin.includes("'bitrix','🛡 Carga Bitrix'"));
assert.ok(html.includes('bitrix.css'));
console.log('✔ Bitrix: existentes intactos, colisiones y responsables protegidos.');
