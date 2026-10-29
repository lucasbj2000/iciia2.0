#!/usr/bin/env node
/** Compatibilidad Baileys 6.7.24 · incoming offline="0".
 * Upstream: WhiskeySockets/Baileys#2810. No toca auth/ ni libsignal.
 * Falla de modo seguro si cambia el código compilado instalado.
 */
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

export function parchearRecepcion(original){
let data=original;
const marca='ICIIA_OFFLINE_ZERO_INBOUND';
if(!data.includes(marca)){
const cambios=[
 [/const isOffline\s*=\s*!!node\.attrs\.offline\s*;/g,
  "const isOffline = node.attrs.offline === '1'; // ICIIA_OFFLINE_ZERO_INBOUND"],
 [/node\.attrs\.offline\s*\?\s*['"]append['"]\s*:\s*['"]notify['"]/g,
  "node.attrs.offline === '1' ? 'append' : 'notify'"],
 [/offline:\s*!!attrs\.offline/g,"offline: attrs.offline === '1'"]
];
for(const [busqueda,reemplazo] of cambios){
 const matches=[...data.matchAll(busqueda)];
 const minimo=busqueda===cambios[2][0]?2:1;
 if(matches.length<minimo||matches.length>4){
   throw Error('Baileys cambió su código offline: parche no aplicado. Revisá versión.');
 }
 data=data.replace(busqueda,reemplazo);
}
}
// En 6.7.24, una notificación offline que rechaza deja isProcessing=true
// para siempre. Los nodos siguientes se encolan, pero nunca se ejecutan.
// Aislar el error por nodo y liberar la bandera sin alterar claves ni ACK.
if(!data.includes('ICIIA_OFFLINE_QUEUE_RECOVERY')){
 const patron=/const promise = async \(\) => \{\s*while \(nodes\.length && ws\.isOpen\) \{([\s\S]*?)await nodeProcessor\(node\);\s*\}\s*isProcessing = false;\s*\};/g;
 if([...data.matchAll(patron)].length!==1)throw Error('Baileys cambió su cola offline: parche no aplicado.');
 data=data.replace(patron,(_,cuerpo)=>`const promise = async () => {
                // ICIIA_OFFLINE_QUEUE_RECOVERY
                try {
                    while (nodes.length && ws.isOpen) {${cuerpo}try {
                            await nodeProcessor(node);
                        } catch (error) {
                            ev.emit('impar.recepcion.error', { etapa: 'cola_offline' });
                            onUnexpectedError(error, 'processing offline node');
                        }
                    }
                } finally {
                    isProcessing = false;
                }
            };`);
}
return data;
}

function instalar(){
const raiz=fileURLToPath(new URL('..',import.meta.url));
const opciones=[
  resolve(raiz,'node_modules/@whiskeysockets/baileys/lib/Socket/messages-recv.js'),
  resolve(raiz,'node_modules/@whiskeysockets/baileys/lib/Socket/messages-recv.mjs')
];
const path=opciones.find(existsSync);
if(!path){console.error('✖ No se encontró Baileys messages-recv compilado');process.exit(1);}
const data=parchearRecepcion(readFileSync(path,'utf8'));
writeFileSync(path,data,'utf8');
if(readFileSync(path,'utf8')!==data)throw Error('No se verificó el parche offline');
console.log('✔ Baileys: offline="0" normal y cola offline continúa tras errores.');
}
if(process.argv[1] && pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
 try{instalar();}catch(e){console.error('✖',e.message);process.exitCode=1;}
}
