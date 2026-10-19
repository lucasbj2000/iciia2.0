/** Regression test for live multimedia backup: fake PostgreSQL and tar, no production data. */
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,copyFileSync,readdirSync,rmSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const repo=join(dirname(fileURLToPath(import.meta.url)),'..');
const tmp=mkdtempSync(join(tmpdir(),'impar-backup-'));
const p=join(tmp,'repo');
const bin=join(tmp,'bin');
mkdirSync(join(p,'scripts'),{recursive:true});
mkdirSync(join(p,'media'),{recursive:true});
mkdirSync(join(p,'auth'),{recursive:true});
mkdirSync(bin);
writeFileSync(join(p,'.env'),'DATABASE_URL=postgres://usuario:prueba@localhost/ficcion\n');
writeFileSync(join(p,'media','archivo.txt'),'Contenido multimedia ficticio\n');
writeFileSync(join(p,'auth','creds.json'),'{"ejemplo":true}\n');
copyFileSync(join(repo,'scripts','backup.sh'),join(p,'scripts','backup.sh'));
writeFileSync(join(bin,'pg_dump'),"#!/usr/bin/env bash\nprintf '%s\\n' '-- respaldo PostgreSQL simulado'\n",{mode:0o755});
const tarFalso=[
'#!/usr/bin/env bash',
'/usr/bin/tar "$@" || exit "$?"',
'if [[ "$1" == czf && "$3" == media ]]; then',
'  if [[ "$SIMULAR_TAR" == media_cambia ]]; then',
'    echo "tar: media/archivo.txt: file changed as we read it" >&2',
'    exit 1',
'  elif [[ "$SIMULAR_TAR" == media_error ]]; then',
'    echo "tar: media/archivo.txt: Permission denied" >&2',
'    exit 2',
'  fi',
'elif [[ "$1" == czf && "$3" == auth && "$SIMULAR_TAR" == auth_error ]]; then',
'  echo "tar: auth/creds.json: Permission denied" >&2',
'  exit 2',
'fi',
].join('\n')+'\n';
writeFileSync(join(bin,'tar'),tarFalso,{mode:0o755});
const correr=modo=>spawnSync('bash',['scripts/backup.sh'],{
 cwd:p,encoding:'utf8',timeout:30000,
 env:{...process.env,PATH:bin+':'+process.env.PATH,SIMULAR_TAR:modo}
});
const verificar=nombre=>{
 const resultados=readdirSync(join(p,'backups')).filter(n=>n.startsWith(nombre));
 assert.ok(resultados.length,'Respaldo esperado ausente: '+nombre);
 resultados.forEach(n=>assert.ok(statSync(join(p,'backups',n)).size>0));
 return resultados;
};
try{
 let r=correr('estable');
 assert.equal(r.status,0,r.stdout+'\n'+r.stderr);
 verificar('db_');verificar('auth_');verificar('media_');
 assert.ok(!r.stderr.includes('EN VIVO parcial'));
 console.log('✓ Multimedia estable: respaldo completo');

 r=correr('media_cambia');
 assert.equal(r.status,0,r.stdout+'\n'+r.stderr);
 assert.match(r.stderr,/EN VIVO parcial/);
 assert.match(r.stderr,/media\/ original permanece intacto/);
 verificar('media_en_vivo_');
 assert.ok(statSync(join(p,'media','archivo.txt')).size>0);
 console.log('✓ Multimedia concurrente: copia parcial identificada y sin bloquear actualización');

 r=correr('media_error');
 assert.notEqual(r.status,0);
 assert.match(r.stderr,/distinto a archivo modificado/);
 console.log('✓ Error de permisos: aborta en lugar de ignorarlo');

 r=correr('auth_error');
 assert.notEqual(r.status,0);
 assert.match(r.stderr,/No se pudo respaldar íntegramente la sesión WhatsApp/);
 console.log('✓ Respaldo de auth defectuoso: cancela el despliegue');

 const temporales=readdirSync(join(p,'backups')).filter(n=>n.endsWith('.tmp'));
 assert.equal(temporales.length,0,'No quedan archivos .tmp');
 console.log('✔ IMPAR: respaldo operativo probado con archivos en uso.');
}finally{rmSync(tmp,{recursive:true,force:true});}
