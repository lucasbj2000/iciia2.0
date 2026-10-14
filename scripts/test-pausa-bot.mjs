/**
 * IMPAR · regresiones anti-autorespuesta durante migración desde Bitrix / CRM previo.
 * Datos totalmente ficticios; no requiere conexión a producción.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const leer = archivo => readFileSync(new URL('../'+archivo,import.meta.url),'utf8');
const migration=leer('src/migrations/013_pausar_automensajes_impar.sql');
const bot=leer('src/bot.mjs');
const reception=leer('src/recepcion-impar.mjs');
const worker=leer('src/worker.mjs');
const core=leer('src/core.mjs');
const admin=leer('src/routes/admin.mjs');
const ui=leer('public/js/admin.js');
const neg=leer('src/routes/negociaciones.mjs');

const verificar=(nombre,validacion)=>{
  assert.ok(validacion,nombre);console.log('✓ '+nombre);
};
verificar('Pausa global solamente IMPAR',migration.includes("WHERE codigo='impar'"));
verificar('Bot deshabilitado en flags',migration.includes("'{bot}','false'::jsonb"));
verificar('Bot de empresa deshabilitado',migration.includes("'{activo}','false'::jsonb"));
verificar('Conversaciones previas mantienen modo manual',migration.includes('UPDATE negociaciones SET bot_activo=FALSE'));
verificar('Mensajes antiguos de bot identificados sin cambiar manuales',
  migration.includes('m.bot=TRUE')&&migration.includes("o.estado IN ('pendiente','error')"));
verificar('Cola de bot no enviada y preservada para historial',
  migration.includes("UPDATE outbox SET estado='cancelado'")&&
  migration.includes("UPDATE mensajes m SET estado='cancelado'"));
verificar('Ningún borrado de registros durante migración',
  !/\bDELETE\s+FROM\s+(contactos|mensajes|negociaciones|outbox|usuarios)\b/i.test(migration));
verificar('IA comprueba pausa tras consultar OpenAI',
  bot.includes('empresa_bot?.activo')&&bot.includes('flags?.bot'));
verificar('Todos los mensajes de IA se identifican como automáticos',
  bot.includes('txt,automatico) VALUES ($1,$2,$3,$4,$5,TRUE)'));
verificar('Bot de recepción respeta bandera global',
  reception.includes('!n.flags?.bot')&&reception.includes('!n.empresa_bot?.activo'));
verificar('Todos los mensajes de recepción se identifican como automáticos',
  reception.includes('txt,automatico) VALUES($1,$2,$3,$4,$5,TRUE)'));
verificar('Se controla el estado actual del bot al enviar',
  worker.includes("SELECT flags->>'bot' AS permitido, bot->>'activo' AS activo FROM empresas")&&
  worker.includes('if (o.automatico)'));
verificar('Mensajes MANUALES no se etiquetan automáticos',
  !/automatico\)\s+VALUES/gi.test(neg)&&
  neg.includes('INSERT INTO outbox'));
verificar('La recepción de mensajes entrantes sigue disponible',
  core.includes('export async function ingresarMensaje')&&
  core.includes("INSERT INTO mensajes (empresa_id,negociacion_id,dir,txt"));
verificar('El administrador puede pausar y reactivar de forma expresa',
  admin.includes("r.patch('/bot/pausa'")&&ui.includes("patch('/admin/bot/pausa'"));
verificar('El guardado de instrucciones no cambia el estado de la pausa',
  admin.includes('bot.activo = req.empresa.bot?.activo === true;'));
verificar('Los agentes no pueden reactivar bots mientras sigue la pausa',
  neg.includes('if(activo && (!req.empresa.flags?.bot || !req.empresa.bot?.activo))'));
verificar('Reactivar el bot global no cambia negociaciones anteriores',
  !/if\s*\(!pausado\)\s*\{[\s\S]{0,100}UPDATE negociaciones/.test(admin));
console.log('✔ Pausa de mensajes automáticos IMPAR protegida. Mensajes manuales intactos.');
