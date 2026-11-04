/** IMPAR · reglas del rescate automático de mensajes no descifrados. Sin base de datos ni WhatsApp. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const leer = r => readFileSync(new URL('../' + r, import.meta.url), 'utf8');
const fuente = leer('src/rescate-no-descifrados-impar.mjs')
  .replace(/^import .*;$/gm, '').replace(/\bexport (const|async function|function)/g, '$1');
const ctx = vm.createContext({ console, Number, String, Date, Math });
vm.runInContext(fuente + '\nglobalThis.d=decidirRescate;', ctx);
const decidir = ctx.d;
const ahora = Date.parse('2026-11-03T15:00:00Z'), hace = m => new Date(ahora - m * 60e3).toISOString();
const PN = '595981000001@s.whatsapp.net', LID = '123456789012345@lid';
const base = { reintentos: 1, reintento_ts: hace(1), jid_tipo: 'pn' };

assert.equal(decidir({ ...base, reintentos: 0 }, LID, ahora), 'nada', 'Sin aviso de WhatsApp no se toca');
assert.equal(decidir(base, LID, ahora), 'esperar', 'Primer aviso reciente: deja actuar al reintento propio de WhatsApp');
assert.equal(decidir({ ...base, reintentos: 2 }, LID, ahora), 'reenviar', 'Segundo aviso: el reintento falló, reenviar por LID');
assert.equal(decidir({ ...base, reintento_ts: hace(6) }, LID, ahora), 'reenviar', 'Cinco minutos sin leerse: reenviar');
assert.equal(decidir({ ...base, reintentos: 3, leido_ts: hace(0) }, LID, ahora), 'nada', 'Leído después del aviso: se descifró');
assert.equal(decidir({ ...base, reintentos: 3, reenviado_ts: hace(0) }, LID, ahora), 'nada', 'Nunca dos veces');
assert.equal(decidir({ ...base, reintentos: 3 }, PN, ahora), 'sin_alternativa', 'Misma ruta que falló: no insistir');
assert.equal(decidir({ ...base, reintentos: 3, rescate: 'sin_alternativa' }, LID, ahora), 'reenviar', 'Apareció la ruta: se reenvía solo');
assert.equal(decidir({ ...base, reintentos: 3, reenvio_de: 7 }, LID, ahora), 'agotado', 'Un reenvío no se reenvía (sin rebotes)');
assert.equal(decidir({ ...base, reintentos: 3, reintento_ts: hace(25 * 60) }, LID, ahora), 'nada', 'Más de 24 h: no reenviar algo viejo');
assert.equal(decidir({ ...base, reintentos: 2, jid_tipo: 'lid' }, PN, ahora), 'reenviar', 'También de LID a número');

// Conexiones
const worker = leer('src/worker.mjs'), ent = leer('src/wa-entregas-impar.mjs'), ui = leer('public/js/ficha.js');
const rutas = leer('src/routes/negociaciones.mjs'), mig = leer('src/migrations/031_wa_rescate_automatico_impar.sql');
assert.ok(worker.includes('setInterval(() => rescatarNoDescifrados()'), 'Corre solo, cada minuto');
assert.ok(ent.includes('leido_ts=CASE WHEN EXCLUDED.ack>=4'), 'Registra la lectura');
assert.ok(fuente.includes("AND reenviado_ts IS NULL AND (rescate IS NULL OR rescate='sin_alternativa')"), 'Reclamo atómico');
assert.ok(rutas.includes('UPDATE outbox SET reenvio_de=$1'), 'El reenvío manual también se marca');
assert.ok(mig.includes('reenvio_de BIGINT REFERENCES outbox(id)') && mig.includes("conrelid='wa_entregas_impar'::regclass"), 'Migración');
assert.ok(!ui.includes('no pudo leerlo') && !ui.includes('no le llegó al cliente') && !ui.includes('msg-no-visto'), 'El agente no ve avisos: el CRM lo resuelve solo');
assert.ok(!/autoReenviarWA/.test(ui), 'Sin reenvíos desde el navegador');
console.log('✔ IMPAR: rescate automático de «Esperando mensaje» (espera, una sola vez, sin rebotes, aviso al admin).');
