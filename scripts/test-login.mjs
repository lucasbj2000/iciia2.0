#!/usr/bin/env node
/* Regresión autónoma del acceso: si falla el módulo CRM, el login es utilizable. */
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source=readFileSync(new URL('../public/js/login-rescate.js',import.meta.url),'utf8');
function iniciar({token='',respuesta={status:401,body:{error:'Usuario o contraseña incorrectos.'}}}={}){
  const domListeners=new Map(),winListeners=new Map(),timers=[],storage={iciia_token:token};
  const clases=()=>{const s=new Set();return {add:v=>s.add(v),remove:v=>s.delete(v),contains:v=>s.has(v)}};
  const elementos=new Map();
  for(const id of ['form-login','login','inicio-estado','l-btn','l-err','l-usr','l-pwd']){
    elementos.set(id,{id,classList:clases(),textContent:id==='l-btn'?'Ingresar':'',value:id==='l-usr'?'agente.demo':id==='l-pwd'?'clave-de-prueba':'',
      disabled:false,style:{},setAttribute(){},addEventListener(type,cb){domListeners.set('form:'+type,cb);}});
  }
  const root={classList:clases()};
  let recargas=0,peticiones=[];
  const sessionStore={};
  const contexto={
    document:{documentElement:root,getElementById:(id)=>elementos.get(id)||null,
      addEventListener:(ev,cb)=>domListeners.set(ev,cb)},
    window:{__imparAppLista:false,addEventListener:(ev,cb)=>winListeners.set(ev,cb)},
    localStorage:{getItem:(k)=>storage[k]||null,setItem:(k,v)=>{storage[k]=v;}},
    sessionStorage:{getItem:(k)=>sessionStore[k]||null,setItem:(k,v)=>{sessionStore[k]=v;}},
    fetch:async(url,opts)=>{
      peticiones.push({url,opts});
      return {ok:respuesta.status>=200&&respuesta.status<300,status:respuesta.status,
        headers:{get:()=> 'application/json'},json:async()=>respuesta.body};
    },
    location:{reload:()=>{recargas++;}},
    setTimeout:(fn)=>{timers.push(fn);return timers.length;},
    clearTimeout:()=>{},
    AbortController
  };
  vm.runInNewContext(source,contexto);
  domListeners.get('DOMContentLoaded')();
  return {
    root,elementos,timers,peticiones,storage,get recargas(){return recargas;},
    enviar:async()=>{
      const ev={preventDefault(){},stopImmediatePropagation(){}};
      return domListeners.get('form:submit')(ev);
    }
  };
}
const sinSesion=iniciar();
assert.equal(sinSesion.root.classList.contains('sesion-verificando'),false,'Sin token el formulario debe permanecer visible');
const conToken=iniciar({token:'sesion-vieja'});
assert.equal(conToken.root.classList.contains('sesion-verificando'),true,'Solo se oculta formulario con token guardado');
conToken.timers[0]();
assert.equal(conToken.root.classList.contains('sesion-verificando'),false,'Si fallan los módulos se revela el acceso');
assert.match(conToken.elementos.get('l-err').textContent,/No se pudo iniciar/);

const credencialesErroneas=iniciar();
await credencialesErroneas.enviar();
assert.match(credencialesErroneas.elementos.get('l-err').textContent,/incorrectos/);
assert.equal(credencialesErroneas.elementos.get('l-btn').disabled,false,'El botón no queda bloqueado');
assert.equal(credencialesErroneas.peticiones[0].url,'/api/login');
assert.equal(credencialesErroneas.peticiones[0].opts.cache,'no-store');

const credencialesCorrectas=iniciar({respuesta:{status:200,body:{token:'jwt-de-prueba'}}});
await credencialesCorrectas.enviar();
assert.equal(credencialesCorrectas.storage.iciia_token,'jwt-de-prueba');
assert.equal(credencialesCorrectas.recargas,1,'La entrada de rescate reintenta cargar el CRM');
assert.equal(credencialesCorrectas.elementos.get('l-btn').disabled,false);

const app=readFileSync(new URL('../public/js/app.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const srv=readFileSync(new URL('../src/server.mjs',import.meta.url),'utf8');
assert.ok(app.includes('window.__imparAppLista = true'),'El CRM debe marcar su carga correcta');
assert.ok(app.includes('accesoAceptado'),'Nunca se descartan credenciales ya aceptadas');
assert.ok(!html.includes('class="sesion-verificando"'),'El formulario no puede quedar oculto sin JavaScript');
assert.ok(html.includes('login-rescate.js'),'Debe funcionar el acceso de emergencia');
assert.ok(srv.includes("app.get('/api/login/health'"),'Debe existir prueba de circuito de login');
assert.ok(srv.includes("auditar(empresa?.id || null") && srv.includes('.catch(e => console.warn'),'El fallo de auditoría no debe bloquear la autenticación');
console.log('✔ Acceso de rescate y contrato de sesión sin bloqueo validados.');
