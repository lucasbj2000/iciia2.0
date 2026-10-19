/** Protocolo 002: probar script real de verificación de publicación en servidor ficticio.
 * Nunca consulta ni toca crm.iciia.tech durante las pruebas.
 */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';

const raiz=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const leer=f=>readFileSync(resolve(raiz,f));
const despliegue=leer('scripts/actualizar.sh').toString();
const respaldo=leer('scripts/backup.sh').toString();
const bd=leer('src/db.mjs').toString();
const publicacion=leer('scripts/verificar-publicacion.sh').toString();

const i=x=>despliegue.indexOf(x);
assert.ok(i('bash scripts/backup.sh')>=0);
assert.ok(i('bash scripts/backup.sh')<i('git merge --ff-only "$DESTINO_SHA"'),
  'El respaldo se realiza ANTES de modificar archivos del CRM');
assert.ok(i('await migrar()')<i('pm2 reload iciia-crm --update-env'),
  'Migraciones verificadas antes del reinicio WhatsApp');
assert.ok(despliegue.includes('flock -n 9'),'Un solo despliegue a la vez');
assert.ok(despliegue.includes('git merge --ff-only'),'No se hace force push/reset durante instalación');
assert.ok(despliegue.includes('git reset --hard "$ANTES_SHA"'),'Rollback del código ante error');
assert.ok(despliegue.includes('IMPAR_OBJETIVO_SHA'),'Permite fijar SHA exacto');
assert.ok(despliegue.includes('bash scripts/verificar-publicacion.sh'),'Compara archivos públicos');
assert.ok(despliegue.includes("if [[ \"$PUBLICO_OK\" != 1 ]]"),'Falla pública es visible');
assert.ok(despliegue.includes('NO se restaura un servidor saludable'),'No regresar por CDN/cache');
assert.ok(bd.includes("SELECT pg_advisory_xact_lock(hashtext('impar-migraciones-v2'))"));
const migra=bd.slice(bd.indexOf('export async function migrar()'),bd.indexOf('/* ================= SEMILLA'));
assert.ok(migra.includes('await tx(async c =>'),'Marcador y SQL en una transacción');
assert.ok(migra.indexOf("await c.query(readFileSync(")<migra.indexOf("await c.query('INSERT INTO _migraciones"),
  'Registrar únicamente migración SQL exitosa');
assert.ok(respaldo.includes('gzip -t "$TEMP"'),'Validar gzip de respaldo');
assert.ok(respaldo.includes('umask 077'),'Archivos de respaldo privados');
assert.ok(respaldo.includes('tar czf "$DIR/auth_'),'Sesiones WhatsApp respaldadas');
assert.ok(respaldo.includes('tar czf "$DIR/media_'),'Archivos adjuntos respaldados');
assert.ok(publicacion.includes('cmp -s "$LOCAL" "$TEMP/respuesta"'),'Compara contenido real');
assert.ok(publicacion.includes('SHA="$(git rev-parse --short=12 HEAD)"'));
assert.ok(!/rm -rf (auth|media)/.test(despliegue+respaldo),'Nunca eliminar datos ni sesiones');

const SHA=execFileSync('git',['rev-parse','--short=12','HEAD'],{cwd:raiz,encoding:'utf8'}).trim();
let mode='ok';
const server=createServer((req,res)=>{
  const path=req.url?.split('?')[0];
  if(path==='/api/health'){
    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify({ok:true,build:mode==='build-antiguo'?'old-sha':SHA}));
    return;
  }
  const filename=path==='/'?'public/index.html':path==='/js/app.js'?'public/js/app.js':path==='/js/contactos.js'?'public/js/contactos.js':null;
  if(!filename){res.statusCode=404;res.end();return;}
  if(mode==='js-antiguo' && path==='/js/contactos.js'){
    res.end('/* formulario antiguo */');return;
  }
  res.end(leer(filename));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const puerto=server.address().port;
const verificar=()=>new Promise((resolve,reject)=>{
  const child=spawn('bash',['scripts/verificar-publicacion.sh'],{
    cwd:raiz,env:{...process.env,IMPAR_PUBLIC_URL:'http://127.0.0.1:'+puerto}
  });
  let stdout='',stderr='';
  child.stdout.on('data',b=>stdout+=b);
  child.stderr.on('data',b=>stderr+=b);
  child.on('error',reject);
  child.on('exit',code=>resolve({code,output:stdout+stderr}));
});
try{
  let prueba=await verificar();
  assert.equal(prueba.code,0,prueba.output);
  assert.match(prueba.output,/PUBLICADO/);
  console.log('✓ HTML, JS y API coinciden: verificación real positiva');
  mode='build-antiguo';
  prueba=await verificar();
  assert.notEqual(prueba.code,0);
  assert.match(prueba.output,/Revisión pública distinta/);
  console.log('✓ Backend antiguo: bloquea confirmación');
  mode='js-antiguo';
  prueba=await verificar();
  assert.notEqual(prueba.code,0);
  assert.match(prueba.output,/diferente del código local/);
  console.log('✓ Frontend obsoleto: bloquea confirmación');
}finally{await new Promise(resolve=>server.close(resolve));}
console.log('✔ IMPAR Protocolo 002: pruebas de respaldo, migraciones y web pública.');
