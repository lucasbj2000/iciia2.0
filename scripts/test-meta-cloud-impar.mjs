/** IMPAR · pruebas sin llamadas a Meta, DB real, teléfonos ni credenciales reales. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomBytes,createHmac} from 'node:crypto';
import vm from 'node:vm';
import {cifrarToken,resolverToken} from '../src/meta-secretos-impar.mjs';
const leer=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const vieja=process.env.META_TOKEN_ENCRYPTION_KEY;
process.env.META_TOKEN_ENCRYPTION_KEY=randomBytes(32).toString('hex');
try{
 const token='EAA-token-ficticio-para-pruebas';
 const cifrado=cifrarToken(token);
 assert.ok(cifrado.startsWith('enc:v1:'));
 assert.ok(!cifrado.includes(token));
 assert.equal(resolverToken(cifrado),token);
 assert.equal(resolverToken('token-antiguo'),'token-antiguo');
 assert.notEqual(cifrarToken(token),cifrado,'AES-GCM aleatorio');
 assert.throws(()=>resolverToken(cifrado+'X'),Error);
}finally{
 if(vieja===undefined)delete process.env.META_TOKEN_ENCRYPTION_KEY;
 else process.env.META_TOKEN_ENCRYPTION_KEY=vieja;
}
const meta=leer('src/channels/meta.mjs'),cola=leer('src/meta-webhooks-impar.mjs');
const routes=leer('src/routes/canales.mjs'),server=leer('src/server.mjs');
const worker=leer('src/worker.mjs'),admin=leer('public/js/admin.js');
const migr=leer('src/migrations/022_meta_cloud_segura_impar.sql');
const inicio=meta.indexOf('export function firmaValida(');
const fin=meta.indexOf('/* ---------- Recepción (POST) ---------- */',inicio);
assert.ok(inicio>=0 && fin>inicio);
const contexto=vm.createContext({process:{env:{META_APP_SECRET:'mi-secreto-de-prueba'}},crypto:await import('node:crypto'),Buffer});
vm.runInContext(meta.slice(inicio,fin).replace('export function','function')+
  ';globalThis.firmaValida=firmaValida;',contexto);
const cuerpo=Buffer.from(JSON.stringify({object:'whatsapp_business_account',entry:[]}));
const firma='sha256='+createHmac('sha256','mi-secreto-de-prueba').update(cuerpo).digest('hex');
assert.equal(contexto.firmaValida({rawBody:cuerpo,headers:{'x-hub-signature-256':firma}}),true);
assert.equal(contexto.firmaValida({rawBody:cuerpo,headers:{'x-hub-signature-256':'sha256=invalida'}}),false);
assert.equal(contexto.firmaValida({headers:{'x-hub-signature-256':firma}}),false);
contexto.process.env.META_APP_SECRET='';
assert.equal(contexto.firmaValida({rawBody:cuerpo,headers:{'x-hub-signature-256':firma}}),false,
 'Sin secreto nunca se acepta webhook');
assert.ok(meta.includes('await encolarWebhookMeta(req.body||{},req.rawBody)'),'Insertar antes de ACK');
assert.ok(meta.indexOf('await encolarWebhookMeta(req.body||{},req.rawBody)') <
 meta.indexOf('res.sendStatus(200);'),'ACK sólo tras INSERT');
assert.ok(cola.includes('ON CONFLICT(sha256) DO NOTHING'),'Idempotencia por carga firmada');
assert.ok(cola.includes('FOR UPDATE SKIP LOCKED'),'Concurrencia segura');
assert.ok(cola.includes("procesando_desde < now()-interval '5 minutes'"),
 'Recuperar eventos interrumpidos');
assert.ok(cola.includes('payload=NULL'),'Borrar PII tras procesamiento');
assert.ok(cola.includes("intentos>=6?'cuarentena':'pendiente'"),
 'Fallos se aíslan en cuarentena');
assert.ok(meta.includes('for(const estado of v.statuses || [])'),'Estados asincrónicos');
assert.ok(meta.includes("['sent','delivered','read','failed']"),'Acuses reales y fallidos');
assert.ok(meta.includes('resolverToken(canal.config?.token)'),'Descifrar solo en servidor');
assert.ok(routes.includes('token: cifrarToken(b.token)'),'Nuevo canal cifrado');
assert.ok(routes.includes("b.tipo !== 'whatsapp_api'"),'Alta de API inactiva');
assert.ok(routes.includes("pendienteActivacion: b.tipo==='whatsapp_api'"),'Se advierte staging');
assert.ok(routes.includes("requiere('admin')"),'Solo admin modifica');
assert.ok(routes.includes("META_APP_SECRET")&&routes.includes("META_VERIFY_TOKEN"),
 'Webhooks firmados deben configurarse antes de alta');
assert.ok(server.includes('meta.firmaValida(req)'), 'Verificación previa al webhook');
assert.ok(worker.includes('drenarWebhooksMeta()'),'Worker recupera eventos');
assert.ok(worker.includes('enviadoWA?.messages?.[0]?.id'),'Guardar ID real Cloud');
assert.ok(admin.includes('Cloud API oficial · IMPAR'),'Preparación visible');
assert.ok(migr.includes('meta_webhook_eventos_impar'),'Migración segura');
console.log('✔ IMPAR Cloud: credenciales cifradas, firma exigida, ACK durable, estados y preparación sin activar QR.');
