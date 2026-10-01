// Pruebas de autenticación y aislamiento: dependencias simuladas sin producción.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const empresa={id:'impar-id',codigo:'impar',activa:true};
const admin={id:'admin-id',empresa_id:empresa.id,usuario:'admin',rol:'admin',activo:true,pass_hash:'hash'};
let user=admin;
const queries=[];
const context=vm.createContext({process:{env:{JWT_SECRET:'test-only-key-for-authentication'}}});
const deps={
  jsonwebtoken:{default:{sign:p=>JSON.stringify(p),verify:t=>JSON.parse(t)}},
  bcryptjs:{default:{compare:async p=>p==='test-password',hash:async()=> 'hash'}},
  './db.mjs':{q:async(sql,params)=>{
    queries.push([sql,params]);
    if(sql.includes('FROM empresas')) return {rows:[empresa]};
    if(sql.includes('FROM usuarios')) return {rows:[user]};
    return {rows:[]};
  }}
};
const mod=new vm.SourceTextModule(readFileSync(new URL('../src/auth.mjs',import.meta.url),'utf8'),{context});
await mod.link(async name=>{const d=deps[name];return new vm.SyntheticModule(Object.keys(d),function(){for(const k of Object.keys(d))this.setExport(k,d[k]);},{context});});
await mod.evaluate();
const auth=mod.namespace;
assert.ok((await auth.login({usuario:'admin',password:'test-password'})).token);
assert.ok((await auth.login({empresa:'otra',usuario:'admin',password:'bad'})).error);
assert.ok(queries.some(([sql,p])=>sql.includes('empresa_id=$1')&&p[0]===empresa.id));
async function request(u){user=u;const req={headers:{authorization:'Bearer '+JSON.stringify({uid:u.id}),'x-empresa':'otra'},query:{empresa:'otra'}};let status;const res={status:n=>(status=n,res),json:()=>res};let next=false;await auth.requiere()(req,res,()=>{next=true;});return {req,status,next};}
const good=await request(admin);assert.ok(good.next);assert.equal(good.req.empresaId,empresa.id);
assert.equal((await request({...admin,empresa_id:'otra'})).status,403);
assert.equal((await request({...admin,empresa_id:null})).status,403);
console.log('✔ Login sin código de empresa; contraseña incorrecta; rechazo de admin global/otra empresa; selector externo ignorado.');
