/** IMPAR: recontacto conserva lectura continua del chat del cliente. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {obtenerHistorialContacto,leerCursorMensaje} from '../src/historial-contacto-impar.mjs';
import {combinarHistorial} from '../public/js/historial-chat.js';

const leer=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const api=leer('src/routes/negociaciones.mjs');
const ficha=leer('public/js/ficha.js');
const chat=leer('public/js/chat-mensajes.js');
const html=leer('public/index.html');

const fecha=(n)=>new Date(Date.UTC(2026,8,1)+n*1000).toISOString();
const crear=(id,neg,anterior)=>({
  id,ts:fecha(id),conversacion_id:neg,anterior,
  dir:id%2?'in':'out',txt:'Mensaje '+id,
  creado_negociacion:fecha(0),titulo_negociacion:'Consulta de prueba'
});
const viejos=Array.from({length:150},(_,i)=>crear(i+1,'neg-antigua',true));
const recientes=Array.from({length:9},(_,i)=>crear(i+151,'neg-actual',false));
const todos=[...viejos,...recientes];
const consultas=[];
const q=async(sql,params)=>{
  consultas.push({sql,params});
  assert.equal(params[0],'empresa-impar');
  assert.equal(params[1],'contacto-original');
  assert.equal(params[2],'neg-actual');
  assert.ok(sql.includes('JOIN negociaciones nx ON nx.id=m.negociacion_id'));
  assert.ok(sql.includes('nx.contacto_id=$2'));
  assert.ok(sql.includes('m.empresa_id=$1'));
  assert.ok(sql.includes('ORDER BY m.ts DESC,m.id DESC LIMIT $6'));
  const filtrados=params[3]
    ? todos.filter(m=>m.ts<params[3]||(m.ts===params[3]&&BigInt(m.id)<BigInt(params[4])))
    : [...todos];
  return {rows:filtrados.sort((a,b)=>b.ts.localeCompare(a.ts)||b.id-a.id).slice(0,params[5])};
};
const primera=await obtenerHistorialContacto(q,'empresa-impar','contacto-original','neg-actual');
assert.equal(primera.mensajes.length,120);
assert.equal(primera.mensajesHayAnteriores,true);
assert.ok(primera.mensajes.some(m=>m.anterior===true));
assert.ok(primera.mensajes.some(m=>m.anterior===false));
assert.equal(primera.mensajes.at(-1).id,159);
let acumulados=combinarHistorial([],primera.mensajes);
let cursor=primera.mensajesCursorAnterior;
while(cursor){
  const bloque=await obtenerHistorialContacto(q,'empresa-impar','contacto-original','neg-actual',cursor);
  acumulados=combinarHistorial(acumulados,bloque.mensajes);
  cursor=bloque.mensajesCursorAnterior;
}
assert.equal(acumulados.length,todos.length,'No se pierden mensajes entre reingresos');
assert.equal(new Set(acumulados.map(m=>m.id)).size,todos.length,'Sin duplicaciones');
assert.deepEqual(acumulados.map(m=>m.id),todos.map(m=>m.id),'Orden cronológico');
assert.equal(acumulados[0].inicioConversacion,true,'Inicio de conversación antigua');
assert.equal(acumulados[150].inicioConversacion,true,'Inicio de nueva negociación');
assert.equal(acumulados[151].inicioConversacion,false);
assert.equal(combinarHistorial(acumulados,primera.mensajes).length,todos.length);

assert.deepEqual(leerCursorMensaje('2026-10-01T08:00:00.000Z|159'),{
  fecha:'2026-10-01T08:00:00.000Z',id:'159'});
for(const bad of ['hola|159','2026-10-01|abc','2026-10-01|0','x'.repeat(100)+'|2'])
  assert.throws(()=>leerCursorMensaje(bad),/Cursor/);
assert.ok(api.includes('obtenerNegociacionVisible(req,req.params.id)'));
assert.ok(api.includes("r.get('/:id/mensajes/anteriores', requiere()"));
assert.ok(api.includes('obtenerHistorialContacto(q,req.empresaId,n.contacto_id,n.id'));
assert.ok(ficha.includes('f-mas-mensajes'));
assert.ok(ficha.includes('combinarHistorial(historialVista.mensajes,pagina.mensajes||[])'));
assert.ok(ficha.includes('caja.scrollTop=anteriorTop+(caja.scrollHeight-anteriorAlto)'));
assert.ok(chat.includes('caja.insertBefore(nodo, siguiente)'));
assert.ok(html.includes('/historial-chat.css'));
console.log('✔ IMPAR: histórico continuo, paginación y seguridad sin mover registros.');
