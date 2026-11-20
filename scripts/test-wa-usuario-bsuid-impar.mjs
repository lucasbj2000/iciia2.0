/** IMPAR · clientes de WhatsApp con @usuario (BSUID): se reconocen y se les responde sin número. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { esBSUID, remitenteCloud } from '../src/whatsapp-bsuid-impar.mjs';

assert.ok(esBSUID('PY.13491208655302741918'));
assert.ok(esBSUID('US.ENT.506847293015824'));
for (const no of ['595981123456', '0981123456', 'undefined', '', null, '123@lid', 'PY.12']) assert.ok(!esBSUID(no), String(no));

// Sin número: Meta manda solo from_user_id y contacts[].user_id
let r = remitenteCloud({ from_user_id: 'PY.13491208655302741918', id: 'w1' },
  [{ profile: { name: '', username: 'lauraimpar' }, user_id: 'PY.13491208655302741918' }]);
assert.deepEqual(r, { remitente: 'PY.13491208655302741918', bsuid: 'PY.13491208655302741918', nombre: '@lauraimpar', usuario: '@lauraimpar' });
// Con número: sigue mandando el número y guarda el BSUID
r = remitenteCloud({ from: '595981000111', from_user_id: 'PY.99999999999' }, [{ wa_id: '595981000111', user_id: 'PY.99999999999', profile: { name: 'Ana' } }]);
assert.equal(r.remitente, '595981000111'); assert.equal(r.bsuid, 'PY.99999999999'); assert.equal(r.nombre, 'Ana');
// Payload viejo (sin BSUID): igual que antes
r = remitenteCloud({ from: '595981000222' }, [{ wa_id: '595981000222', profile: { name: 'Beto' } }]);
assert.equal(r.remitente, '595981000222'); assert.equal(r.bsuid, ''); assert.equal(r.nombre, 'Beto');
// Nada identificable: no se inventa «undefined»
assert.equal(remitenteCloud({}, []).remitente, '');

// Envío: al BSUID con «recipient» y sin «to»; al número con «to»
// Se evalúa la función desde el fuente (esta etapa de CI corre sin dependencias instaladas).
const enviados = [];
const meta = readFileSync(new URL('../src/channels/meta.mjs', import.meta.url), 'utf8');
const ini = meta.indexOf('export async function enviarWhatsAppAPI('), fin = meta.indexOf('export async function enviarMeta(');
const ctx = vm.createContext({ esBSUID, process, JSON, String, Error, WA_API: 'https://graph.test', resolverToken: () => 'token',
  urlPublica: u => 'https://crm.test' + u,
  fetch: async (_u, o) => { enviados.push(JSON.parse(o.body)); return { ok: true, json: async () => ({ messages: [{ id: 'wamid.X' }] }) }; } });
vm.runInContext(meta.slice(ini, fin).replace(/^export /, '') + ';globalThis.enviarWhatsAppAPI=enviarWhatsAppAPI;', ctx);
const { enviarWhatsAppAPI } = ctx;
const canal = { id: 'c', tipo: 'whatsapp_api', config: { phone_number_id: '123', token: 'tok-prueba' } };
await enviarWhatsAppAPI(canal, 'PY.13491208655302741918', 'Hola');
assert.equal(enviados[0].recipient, 'PY.13491208655302741918'); assert.ok(!('to' in enviados[0]));
await enviarWhatsAppAPI(canal, '0981000333', 'Hola');
assert.equal(enviados[1].to, '595981000333'); assert.ok(!('recipient' in enviados[1]));
await assert.rejects(enviarWhatsAppAPI(canal, 'undefined', 'Hola'), /número de WhatsApp válido/);

// El ingreso no toma el BSUID ni «undefined» como teléfono, y lo busca por whatsapp_bsuid
const core = readFileSync(new URL('../src/core.mjs', import.meta.url), 'utf8');
assert.match(core, /!esBSUID\(remitente\)/);
assert.match(core, /externos->>'whatsapp_bsuid'=\$2 OR externos->>'whatsapp'=\$2/);
assert.match(core, /whatsapp_bsuid: bsuid/);
const worker = readFileSync(new URL('../src/worker.mjs', import.meta.url), 'utf8');
assert.match(worker, /bsuid: m\.payload\?\.bsuid/);
assert.match(worker, /o\.tipo === 'whatsapp_qr' && esBSUID\(o\.destino\)/);
const mig = readFileSync(new URL('../src/migrations/046_whatsapp_usuario_impar.sql', import.meta.url), 'utf8');
assert.match(mig, /tel='undefined'/);
console.log('✓ WhatsApp con @usuario: se reconoce por BSUID, se responde con recipient y no queda «undefined»');
// Sin número ni usuario: la respuesta se rechaza con aviso, no queda como «enviada» sin salir.
const rutas = readFileSync(new URL('../src/routes/negociaciones.mjs', import.meta.url), 'utf8');
assert.match(rutas, /if \(canal && !destino\) throw Object\.assign\(new Error\(SIN_DESTINO\), \{ status: 422 \}\)/);
assert.match(rutas, /if \(d\.canal && !d\.destino\) return res\.status\(422\)/);
assert.match(rutas, /v !== 'undefined'/);
console.log('✓ Respuesta sin destinatario: aviso claro en vez de mensaje que nunca sale');
