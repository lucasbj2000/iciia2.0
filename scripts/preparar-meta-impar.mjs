/** Inicializa secretos locales de Meta sin mostrarlos ni cambiar los existentes. */
import {readFileSync,writeFileSync,chmodSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
const file=new URL('../.env',import.meta.url);
let env;
try{env=readFileSync(file,'utf8');}
catch{console.error('Primero creá .env en Hostinger. No se creó ninguno automáticamente.');process.exit(1);}
const asegurar=(nombre,valor)=>{
 const re=new RegExp('^'+nombre+'=(.*)$','m');
 const m=re.exec(env);
 if(m?.[1]?.trim())return false;
 if(m)env=env.replace(re,nombre+'='+valor);
 else env+=(env.endsWith('\n')?'':'\n')+nombre+'='+valor+'\n';
 return true;
};
const cambios=[
 ['META_TOKEN_ENCRYPTION_KEY',randomBytes(32).toString('hex')],
 ['META_VERIFY_TOKEN',randomBytes(24).toString('hex')]
].filter(([k,v])=>asegurar(k,v)).map(([k])=>k);
if(cambios.length){
 chmodSync(file,0o600);
 writeFileSync(file,env,{mode:0o600});
}
console.log('Configuración local de Meta: '+(cambios.length?'creadas '+cambios.join(' y '):'claves previamente existentes conservadas'));
console.log('META_APP_SECRET: '+(/^META_APP_SECRET=\S+$/m.test(env)?'configurado':'PENDIENTE (Meta Developers → App settings → Basic)'));
console.log('No se imprimieron secretos. El Verify Token aparece para el administrador en CRM → Canales → Webhook.');
console.log('IMPORTANTE: respaldá .env de forma segura; sin esta clave se perdería acceso a tokens cifrados.');
