/** IMPAR: regressions para buscar contactos sin spinner ni parámetros SQL rotos.
 * Usa datos ficticios; la query se ejecuta también con PostgreSQL real en CI.
 */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const leer=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const server=leer('src/routes/contactos.mjs');
const ui=leer('public/js/contactos.js');
const start=server.indexOf("r.get('/', requiere(), async (req, res) => {");
const end=server.indexOf("\nr.get('/chequeo'",start);
assert.ok(start>=0 && end>start,'Falta endpoint listado de contactos');
const fragment=server.slice(start,end);
let endpoint,consulta,params;
const r={get:(_path,_mw,fn)=>{endpoint=fn;}};
const q=async(sql,p)=>{consulta=sql;params=p;return {rows:[]};};
vm.runInNewContext(fragment,{r,requiere:()=>()=>{},q});
const req={query:{q:'Camila'},empresaId:'empresa-ficticia',
  user:{id:'admin-ejemplo',rol:'admin'},empresa:{etapas:[{id:'contactado',activa:true}]}};
let resultado;
await endpoint(req,{json:x=>{resultado=x;}});
assert.deepEqual(resultado,[]);
assert.equal(params.length,3);
assert.equal(params[1],'%camila%');
assert.ok(consulta.includes('lower(c.email) LIKE $2'));
assert.ok(consulta.includes('lower(c.direccion) LIKE $2'));
assert.ok(consulta.includes('t.numero LIKE $2'));
assert.ok(!consulta.includes('LIKE 2'),'Nunca generar LIKE 2 sin placeholder $');
assert.ok(consulta.includes('c.empresa_id = $1'));
assert.ok(consulta.includes('LIMIT 500'));
assert.ok(ui.includes('++ultimaConsultaContactos'),'Descartar peticiones antiguas');
assert.ok(ui.includes("No se pudo cargar Contactos"));
assert.ok(ui.includes("No se pudo buscar. Reintentá."));
assert.ok(ui.includes("teniaFoco"),'Mantener foco durante escritura');
assert.ok(ui.includes("if(!inputAntes)vista.innerHTML="),
  'No tapar toda la lista con un skeleton por cada búsqueda');
assert.ok(ui.includes("tel:$('#f-tel').value.trim()"));
assert.ok(ui.includes("conservarAnterior:$('#f-conservar-anterior')?.checked===true"));
assert.ok(!ui.includes('id="f-tel" readonly'));
console.log('✔ IMPAR: búsqueda SQL parametrizada y formulario no se bloquea.');
