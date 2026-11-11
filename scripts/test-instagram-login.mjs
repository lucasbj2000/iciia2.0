// Instagram con inicio de sesión de Instagram: token «IG…», cuenta sin página y suscripción de la cuenta.
import assert from 'node:assert/strict';
const { resolverCuentaSocial, suscribirPagina, esTokenInstagram } = await import('../src/redes-sociales-impar.mjs');
const llamadas = [];
const falso = respuestas => async (url, op = {}) => {
  llamadas.push({ url, metodo: op.method || 'GET', auth: op.headers?.Authorization });
  const j = respuestas(url);
  return { ok: !j.error, json: async () => j };
};
assert.equal(esTokenInstagram('IGAAx123'), true);
assert.equal(esTokenInstagram('EAAB123'), false);
const r = await resolverCuentaSocial({ tipo: 'instagram', token: 'IGAAprueba' },
  falso(u => u.includes('graph.instagram.com') && u.includes('/me?') ? { user_id: '17841400000000001', username: 'impar_papeles' } : { error: { code: 100 } }));
assert.equal(r.ok, true);
assert.equal(r.cuenta.ig_id, '17841400000000001');
assert.equal(r.cuenta.api, 'instagram');
assert.equal(r.cuenta.page_id, '');
const otra = await resolverCuentaSocial({ tipo: 'instagram', token: 'IGAAprueba', ig_id: '999' }, falso(() => ({ user_id: '17841400000000001' })));
assert.equal(otra.ok, false, 'Un token de otra cuenta no reemplaza al canal');
llamadas.length = 0;
const s = await suscribirPagina('', 'IGAAprueba', falso(() => ({ success: true })));
assert.equal(s.ok, true);
assert.match(llamadas[0].url, /graph\.instagram\.com\/v\d+\.0\/me\/subscribed_apps\?subscribed_fields=messages/);
assert.equal(llamadas[0].metodo, 'POST');
// Token del sistema (EAA…) con permisos de Instagram pero sin páginas: se usa la cuenta por su ID.
const d = await resolverCuentaSocial({ tipo: 'instagram', token: 'EAAprueba', ig_id: '17841408816799444' },
  falso(u => u.includes('/me/accounts') ? { error: { code: 200 } } : u.includes('/17841408816799444?') ? { id: '17841408816799444', username: 'impar_papeles' } : { error: { code: 100 } }));
assert.equal(d.ok, true); assert.equal(d.cuenta.api, 'facebook_ig'); assert.equal(d.cuenta.page_id, '');
assert.equal((await suscribirPagina('', 'EAAprueba', falso(() => ({})))).ok, true, 'Sin página: la suscripción queda en la app de Meta');
const sinId = await resolverCuentaSocial({ tipo: 'instagram', token: 'EAAprueba' }, falso(u => u.includes('/me/accounts') ? { data: [] } : { error: { code: 100 } }));
assert.equal(sinId.ok, false, 'Sin páginas ni ID de Instagram no se puede conectar');
const meta = await import('../src/channels/meta.mjs').catch(() => null);
if (meta?.usaLoginInstagram) {
  assert.equal(meta.usaLoginInstagram({ tipo: 'instagram', config: {} }, 'IGAAx'), true);
  assert.equal(meta.usaLoginInstagram({ tipo: 'instagram', config: {} }, 'EAAx'), false);
  assert.equal(meta.usaLoginInstagram({ tipo: 'messenger', config: {} }, 'IGAAx'), false);
}
console.log('✔ Instagram con inicio de sesión de Instagram: token propio, sin página y suscripción de la cuenta.');
process.exit(0);
