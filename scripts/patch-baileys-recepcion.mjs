#!/usr/bin/env node
/** Compatibilidad Baileys 6.7.24 · incoming offline="0".
 * Upstream: WhiskeySockets/Baileys#2810. No toca auth/ ni libsignal.
 * Falla de modo seguro si cambia el código compilado instalado.
 */
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
const raiz=resolve(new URL('..',import.meta.url).pathname);
const opciones=[
  resolve(raiz,'node_modules/@whiskeysockets/baileys/lib/Socket/messages-recv.js'),
  resolve(raiz,'node_modules/@whiskeysockets/baileys/lib/Socket/messages-recv.mjs')
];
const path=opciones.find(existsSync);
if(!path){console.error('✖ No se encontró Baileys messages-recv compilado');process.exit(1);}
let data=readFileSync(path,'utf8');
const marca='ICIIA_OFFLINE_ZERO_INBOUND';
if(data.includes(marca)){console.log('✔ Corrección offline="0" ya aplicada');process.exit(0);}
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
   console.error('✖ Baileys cambió su código offline: parche no aplicado. Revisá versión.');
   process.exit(1);
 }
 data=data.replace(busqueda,reemplazo);
}
writeFileSync(path,data,'utf8');
if(!readFileSync(path,'utf8').includes(marca))throw Error('No se verificó el parche offline');
console.log('✔ Baileys offline="0" tratado como evento normal; session Signal intacta.');
