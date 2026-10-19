/** Regression: la Ficha 360 debe pedir datos y permitir cerrar incluso mientras carga.
 * Simula el DOM y la API; no necesita credenciales, datos reales ni PostgreSQL.
 */
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../public/js/contactos.js',import.meta.url),'utf8');
const start=source.indexOf('export async function ficha360(id) {');
const end=source.indexOf('\nfunction importar(e)',start);
assert.ok(start>=0 && end>start,'No se encontró la ficha 360');
const fragment=source.slice(start,end).replace('export async function ficha360','async function ficha360');
const lines=source.split('\n');
for(const [i,line] of lines.entries()){
  assert.ok(!/(^|[^$])\$\([^)]*\)\.forEach\s*\(/.test(line),
    'No usar querySelector().forEach(): línea '+(i+1)+' '+line);
  assert.ok(!line.includes('$$$('),'No existe un helper $$$, línea '+(i+1));
}

const make=({response,error,pendiente=false}={})=>{
  let content='',closed=0,apiCalls=0,requestResolve,requestReject;
  let release=new Promise((resolve,reject)=>{requestResolve=resolve;requestReject=reject;});
  const botones=[],inputs=new Map();
  const elemento=sel=>{
    if(!inputs.has(sel))inputs.set(sel,{value:'',disabled:false,isConnected:true,
      dataset:{},textContent:'',onclick:null,style:{}});
    return inputs.get(sel);
  };
  const $=sel=>{
    if(sel==='[data-ficha-cargando]')return content.includes('data-ficha-cargando')?elemento(sel):null;
    if(sel==='[data-abrir]')return null;
    if(sel==='#f-cambiar-responsable')return null;
    if(sel==='.modal')return elemento(sel);
    return elemento(sel);
  };
  const $$=sel=>{
    if(sel==='[data-cerrar]'){
      const cantidad=(content.match(/data-cerrar/g)||[]).length;
      while(botones.length<cantidad)botones.push({onclick:null});
      return botones.slice(0,cantidad);
    }
    return [];
  };
  const modal=html=>{content=html;botones.length=0;};
  const cerrar=()=>{closed++;content='';};
  const fixture=response||{
    id:'ejemplo-id',nombre:'Cliente Ejemplo',tel:'595981234567',
    resumen:{total:0,ganadas:0,monto:0,conversion:0},
    negociaciones:[],telefonos:[{numero:'595981234567',tel_norm:'81234567',etiqueta:'Principal'}],
    editable:true,externos:{},ubicaciones:[],ciudad:'Asunción',creado:'2026-10-19T10:00:00Z'
  };
  const context={ultimaCargaFicha:0,$,$$,modal,cerrar,esc:x=>String(x??''),api:()=>{apiCalls++;
      return pendiente?release:(error?Promise.reject(error):Promise.resolve(fixture));
    },AbortSignal,activarVisor:()=>{},etapa:()=>({nombre:'Nuevo',color:'#000'}),
    fdate:()=> '19/10/2026',fd:()=> '19/10/2026',gs:x=>x,toast:()=>{},
    S:{empresa:{etapas:[]},usuario:{rol:'agente'}},
    fichaNeg:()=>{},cambiarResponsableContacto:()=>{},vistaContactos:()=>{},
    patch:async()=>({ok:true}),post:async()=>({ok:true}),del:async()=>({ok:true}),
    confirm:()=>true};
  vm.runInNewContext(fragment,context);
  return {abrir:id=>vm.runInNewContext('ficha360("'+id+'")',context),
    get html(){return content;},get closed(){return closed;},get apiCalls(){return apiCalls;},
    botones,elemento,resolve:requestResolve,reject:requestReject};
};

const slow=make({pendiente:true});
const loading=slow.abrir('cliente-a');
assert.equal(slow.apiCalls,1,'Al abrir la ficha realiza inmediatamente el GET');
assert.match(slow.html,/Consultando información del cliente/);
assert.equal(typeof slow.botones[0]?.onclick,'function','La X funciona incluso durante la carga');
slow.botones[0].onclick();
assert.equal(slow.closed,1,'El botón X cierra la ventana');
assert.equal(slow.html,'','La pantalla se desbloquea');
slow.resolve({id:'cliente-a'});
await loading;
assert.equal(slow.html,'','Una respuesta tardía no vuelve a abrir la ficha');
console.log('✓ Ficha abre la petición, permite cerrar durante carga y descarta respuesta tardía');

const failed=make({error:new Error('Error de red simulado')});
await failed.abrir('cliente-b');
assert.match(failed.html,/No se pudo cargar la ficha 360/);
assert.match(failed.html,/Error de red simulado/);
assert.match(failed.html,/Reintentar/);
assert.equal(typeof failed.botones[0]?.onclick,'function','X disponible en estado de error');
failed.botones[0].onclick();
assert.equal(failed.closed,1);
console.log('✓ Error de API se muestra con botón Reintentar y cierre operativo');

const ok=make();
await ok.abrir('cliente-c');
assert.equal(ok.apiCalls,1);
assert.match(ok.html,/Teléfonos vinculados/);
assert.match(ok.html,/Cliente Ejemplo/);
assert.equal(typeof ok.botones[0]?.onclick,'function','Cierre de ficha cargada');
console.log('✓ La ficha 360 renderiza clientes ficticios sin fallar en otros selectores');
console.log('✔ IMPAR: regresiones reales de apertura, carga, error y cierre de Ficha 360.');
