import assert from 'node:assert/strict';
import {autorizadoLaboratorio,diagnosticarMeta,PHONE_ID} from '../src/meta-laboratorio-impar.mjs';
assert.equal(autorizadoLaboratorio({rol:'admin',usuario:'admin'},{codigo:'impar'}),true);
for(const u of [{rol:'agente',usuario:'admin'},{rol:'admin',usuario:'otro'},null]) assert.equal(autorizadoLaboratorio(u,{codigo:'impar'}),false);
assert.equal(autorizadoLaboratorio({rol:'admin',usuario:'admin'},{codigo:'nova'}),false);
let calls=[];const token='test_token_no_real_1234567890';
const r=await diagnosticarMeta(token,async(url,opts)=>{
  calls.push(url);assert.equal(opts.method,'GET');assert.equal(opts.redirect,'error');assert.equal(opts.headers.Authorization,`Bearer ${token}`);
  assert.equal(new URL(url).hostname,'graph.facebook.com');assert.ok(!url.includes(token));
  assert.ok(!/\/messages|\/register|\/subscriptions\?/.test(url));
  return {ok:true,json:async()=>({id:PHONE_ID,data:[{id:PHONE_ID,name:'test'}],paging:{next:`https://example.invalid/?access_token=${token}`}})};
});
assert.equal(calls.length,4);assert.equal(r.resultados.pertenencia.datos.coincide,true);
assert.ok(!JSON.stringify(r).includes(token));
await assert.rejects(()=>diagnosticarMeta('bad',()=>{throw Error('must not call');}));
const failed=await diagnosticarMeta(token,async()=>({ok:false,status:400,json:async()=>({error:{code:190,message:token}})}));
assert.equal(failed.resultados.numero.codigo,190);assert.ok(!JSON.stringify(failed).includes(token));
const timeout=await diagnosticarMeta(token,async()=>{throw Error(token);});assert.ok(!JSON.stringify(timeout).includes(token));
console.log('✔ Laboratorio: permisos por usuario/empresa, GET fijos, sin secretos en resultados, errores y pertenencia.');
