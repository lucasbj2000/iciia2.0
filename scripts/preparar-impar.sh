#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
ORIGIN="$(git remote get-url origin)"
case "$ORIGIN" in https://github.com/lucasbj2000/iciia2.0.git|https://github.com/lucasbj2000/iciia2.0|git@github.com:lucasbj2000/iciia2.0.git) ;; *) echo 'Este script solo sirve para lucasbj2000/iciia2.0.' >&2; exit 1;; esac
node scripts/verificar.mjs
read -r -s -p 'Contraseña para admin de IMPAR: ' ADMIN_PASS
printf '\n'
export ADMIN_PASS
# Respaldo completo antes de borrar: base, entorno y directorios configurados.
node --input-type=module <<'JS'
import 'dotenv/config';
import {execFileSync} from 'node:child_process';
import {mkdirSync,copyFileSync,existsSync,chmodSync,writeFileSync} from 'node:fs';
const dir='backups/impar-reset-'+Date.now();mkdirSync(dir,{recursive:true,mode:0o700});
execFileSync('pg_dump',['--format=custom','--file='+dir+'/database.dump'],{env:{...process.env,PGDATABASE:process.env.DATABASE_URL},stdio:['ignore','inherit','inherit']});
copyFileSync('.env',dir+'/environment.env');chmodSync(dir+'/environment.env',0o600);
for (const [i,p] of [process.env.WA_AUTH_DIR||'auth',process.env.MEDIA_DIR||'media'].entries()) if(existsSync(p)) execFileSync('tar',['czf',dir+'/files-'+i+'.tar.gz',p]);
writeFileSync(dir+'/revision.txt',execFileSync('git',['rev-parse','HEAD']));
console.log('Respaldo:',dir);
JS
pm2 stop iciia-crm
if ! IMPAR_RESET=BORRAR_DATOS_ICIIA2 node scripts/reset-impar.mjs; then
  echo 'Falló la conversión. Servicio detenido para revisar/restaurar respaldo.' >&2
  exit 1
fi
unset ADMIN_PASS
pm2 restart iciia-crm --update-env
pm2 save
PORT_ACTUAL="$(node --input-type=module -e "import 'dotenv/config'; console.log(process.env.PORT || 3000)")"
for intento in {1..30}; do
  if curl -fsS "http://127.0.0.1:${PORT_ACTUAL}/api/health"; then printf '\nIMPAR operativo.\n'; exit 0; fi
  sleep 1
done
printf '\nNo respondió health; revisar pm2 logs iciia-crm.\n' >&2
exit 1
