import assert from 'node:assert/strict';
import { vigilarBuffer } from '../src/wa-vigilancia-buffer.mjs';

let t=0,activo=true,conectado=true,bloqueado=false,liberados=0,flushes=0,cancelados=0,tick;
const sock={ev:{isBuffering:()=>bloqueado,flush:()=>{flushes++;bloqueado=false;return true;}}};
const detener=vigilarBuffer({sock,vigente:()=>activo,conectado:()=>conectado,
  alLiberar:()=>liberados++,ahora:()=>t,intervalo:fn=>{tick=fn;return 1;},cancelar:()=>cancelados++});
tick(); t=10000; bloqueado=true; tick();
t=39999;tick();assert.equal(flushes,0,'No liberar antes del límite');
t=40000;tick();assert.equal(flushes,1);assert.equal(liberados,1);
t=80000;tick();assert.equal(flushes,1,'No liberar si ya terminó');
bloqueado=true;conectado=false;tick();t=200000;tick();assert.equal(flushes,1,'No liberar desconectado');
conectado=true;tick();activo=false;tick();assert.equal(cancelados,1,'Socket sustituido detiene su vigilancia');
detener();assert.equal(cancelados,1,'Detener es idempotente');
console.log('✔ Vigilancia de WhatsApp: buffer prolongado, cierre y sustitución seguros.');
