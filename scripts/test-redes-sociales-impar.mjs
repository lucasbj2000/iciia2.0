/* Messenger e Instagram: resolución de página/Instagram desde el token, suscripción y errores. Sin llamar a Meta. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { versionGraph, resolverCuentaSocial, suscribirPagina, traducirError, API, CAMPOS_PAGINA } from '../src/redes-sociales-impar.mjs';

assert.equal(versionGraph('v21.0'), 'v26.0', 'v21 se apaga el 21/01/2027');
assert.equal(versionGraph(''), 'v26.0');
assert.equal(versionGraph('v25.0'), 'v25.0');
assert.equal(versionGraph('basura'), 'v26.0');
assert.match(API, /graph\.facebook\.com\/v2[4-9]\.0$/);

const respuesta = (cuerpo, ok = true) => ({ ok, json: async () => cuerpo });
const llamadas = [];
const fakeMeta = mapa => async (url, op) => {
  llamadas.push({ url, op, auth: op.headers.Authorization });
  for (const [patron, cuerpo] of mapa) if (url.includes(patron)) return respuesta(cuerpo, !cuerpo.error);
  return respuesta({ error: { message: 'no simulado' } }, false);
};
const PAG_IMPAR = { id: '111', name: 'Papelerías IMPAR', access_token: 'TOKEN_PAGINA', instagram_business_account: { id: '999', username: 'impar.py' } };
const PAG_OTRA = { id: '222', name: 'Otra página', access_token: 'TOKEN_2' };

// Token de usuario del sistema con una sola página.
let r = await resolverCuentaSocial({ tipo: 'messenger', token: 'TOKEN_SISTEMA' }, fakeMeta([['/me/accounts', { data: [PAG_IMPAR] }]]));
assert.deepEqual(r, { ok: true, cuenta: { page_id: '111', page_nombre: 'Papelerías IMPAR', token_pagina: 'TOKEN_PAGINA', ig_id: '999', ig_usuario: 'impar.py' } });
assert.equal(llamadas.at(-1).auth, 'Bearer TOKEN_SISTEMA', 'el token viaja en cabecera, no en la URL');
assert.ok(!llamadas.at(-1).url.includes('TOKEN'), 'nunca en la URL');

// Varias páginas: Messenger pide elegir (sin exponer tokens); Instagram elige la única con Instagram.
const dos = fakeMeta([['/me/accounts', { data: [PAG_IMPAR, PAG_OTRA] }]]);
r = await resolverCuentaSocial({ tipo: 'messenger', token: 'T' }, dos);
assert.equal(r.ok, false);
assert.deepEqual(r.elegir.map(p => p.page_id), ['111', '222']);
assert.ok(r.elegir.every(p => !('token_pagina' in p)), 'la lista para elegir no lleva tokens');
r = await resolverCuentaSocial({ tipo: 'messenger', token: 'T', page_id: '222' }, dos);
assert.equal(r.cuenta.token_pagina, 'TOKEN_2');
r = await resolverCuentaSocial({ tipo: 'instagram', token: 'T' }, dos);
assert.equal(r.cuenta.ig_id, '999');
r = await resolverCuentaSocial({ tipo: 'instagram', token: 'T', page_id: '222' }, dos);
assert.match(r.error, /no tiene una cuenta de Instagram profesional/);
r = await resolverCuentaSocial({ tipo: 'messenger', token: 'T', page_id: '333' }, dos);
assert.match(r.error, /no está entre las que puede usar el token/);

// Token de página directo: /me/accounts falla y /me es la página.
r = await resolverCuentaSocial({ tipo: 'instagram', token: 'TOKEN_DE_PAGINA' }, fakeMeta([
  ['/me/accounts', { error: { code: 100, message: 'nonexisting field accounts' } }],
  ['/me?fields', { id: '111', name: 'Papelerías IMPAR', instagram_business_account: { id: '999', username: 'impar.py' } }]]));
assert.equal(r.cuenta.token_pagina, 'TOKEN_DE_PAGINA');
assert.equal(r.cuenta.ig_usuario, 'impar.py');

// Sin páginas, token inválido, sin token.
r = await resolverCuentaSocial({ tipo: 'messenger', token: 'T' }, fakeMeta([['/me/accounts', { data: [] }]]));
assert.match(r.error, /ninguna página asignada/);
r = await resolverCuentaSocial({ tipo: 'messenger', token: 'T' }, fakeMeta([
  ['/me/accounts', { error: { code: 190 } }], ['/me?fields', { error: { code: 190, message: 'expired' } }]]));
assert.match(r.error, /venció o fue revocado/);
assert.match((await resolverCuentaSocial({ tipo: 'messenger', token: ' ' })).error, /Falta el token/);

// Suscripción de la página.
const s = await suscribirPagina('111', 'TOKEN_PAGINA', fakeMeta([['/111/subscribed_apps', { success: true }]]));
assert.deepEqual(s, { ok: true });
assert.equal(llamadas.at(-1).op.method, 'POST');
assert.deepEqual(JSON.parse(llamadas.at(-1).op.body), { subscribed_fields: CAMPOS_PAGINA });
assert.match((await suscribirPagina('111', 'X', fakeMeta([['/111/subscribed_apps', { error: { code: 200, message: 'perm' } }]]))).error, /Falta un permiso/);

// Errores para el agente.
assert.match(traducirError({ code: 10, error_subcode: 2018278 }), /más de 24 horas/);
assert.match(traducirError({ code: 100, error_subcode: 2534022 }), /más de 24 horas/);
assert.match(traducirError({ code: 551 }), /bloqueó a la página/);
assert.equal(traducirError({ message: 'otro' }), 'otro');

// Cableado.
const canales = readFileSync(new URL('../src/routes/canales.mjs', import.meta.url), 'utf8');
const meta = readFileSync(new URL('../src/channels/meta.mjs', import.meta.url), 'utf8');
assert.match(canales, /resolverCuentaSocial\(\{ tipo: b\.tipo, token: b\.token/);
assert.match(canales, /token: cifrarToken\(r\.cuenta\.token_pagina\)/, 'el token de página se guarda cifrado');
assert.match(canales, /suscribirPagina\(config\.page_id/);
assert.match(canales, /UPDATE canales SET bot_activo=FALSE/, 'redes sin respuestas automáticas al crear');
assert.doesNotMatch(meta, /process\.env\.GRAPH_VERSION \|\| 'v21\.0'/);
assert.match(meta, /throw new Error\(traducirError\(j\.error\)\)/);
assert.match(meta, /tipo === 'instagram' \? 'name,username' : 'first_name,last_name,name'/, 'Messenger no pide username');
assert.doesNotMatch(meta, /access_token=\$\{/, 'tokens nunca en la URL');
console.log('✔ Messenger e Instagram: página e Instagram desde el token, suscripción, token cifrado y errores claros');
