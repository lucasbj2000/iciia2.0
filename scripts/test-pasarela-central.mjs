/** IMPAR · Pasarela en modo «central» (SIP): G.711, remuestreo, Digest, número, y una llamada
 * real contra la central falsa de pruebas (registro, entrante, saliente y cortes), sin CRM ni WebRTC. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { linealAUlaw, ulawALineal, linealAAlaw, alawALineal, subir, bajar } from '../pasarela-telefono/lib/rtp.mjs';
import { digest, numeroCentral, analizar, leerSDP, sdp, TelefoniaSIP } from '../pasarela-telefono/lib/sip.mjs';

// G.711: ida y vuelta con error chico
for (const v of [0, 100, -100, 1000, -1000, 12000, -12000, 32000, -32000]) {
  assert.ok(Math.abs(ulawALineal(linealAUlaw(v)) - v) <= Math.max(16, Math.abs(v) * 0.07), 'µ-law ' + v);
  assert.ok(Math.abs(alawALineal(linealAAlaw(v)) - v) <= Math.max(16, Math.abs(v) * 0.07), 'A-law ' + v);
}
// Remuestreo
assert.equal(subir(new Int16Array(160), 48000).length, 960);
assert.equal(bajar(new Int16Array(480), 48000).length, 80);
// Digest (ejemplo de la RFC 2617)
const d = digest({ usuario: 'Mufasa', clave: 'Circle Of Life', metodo: 'GET', uri: '/dir/index.html', cnonce: '0a4f113b',
  desafio: 'Digest realm="testrealm@host.com", qop="auth,auth-int", nonce="dcd98b7102dd2f0e8b11d0f600bfb0c093", opaque="5ccc069c403ebaf9f0171e9517f40e41"' });
assert.ok(d.includes('response="6629fae49393a05397450978507c4ef1"'), d);
// Número que marca la central
assert.equal(numeroCentral('+595981000333'), '0981000333');
assert.equal(numeroCentral('+5491122334455'), '005491122334455');
assert.equal(numeroCentral('+595981000333', { prefijoSalida: '9' }), '90981000333');
assert.equal(numeroCentral('+595981000333', { formato: 'nacional' }), '981000333');
assert.equal(numeroCentral('+595981000333', { formato: 'internacional' }), '595981000333');
assert.equal(numeroCentral('+595981000333', { formato: 'mas' }), '+595981000333');
assert.equal(numeroCentral('+595981000333', { formato: '00' }), '00595981000333');
assert.equal(numeroCentral('+595981000333', { formato: 'raro' }), '0981000333');
assert.equal(numeroCentral('802', { formato: 'internacional' }), '802');
// Mensajes y SDP
const m = analizar('SIP/2.0 200 OK\r\nv: SIP/2.0/UDP 1.2.3.4:5062;branch=z9hG4bKa;received=5.6.7.8;rport=4000\r\ni: abc\r\nCSeq: 1 REGISTER\r\n\r\n');
assert.equal(m.codigo, 200); assert.equal(m.h['call-id'][0], 'abc');
assert.deepEqual(leerSDP(sdp({ ip: '1.2.3.4', puerto: 40002, pts: [0] })), { ip: '1.2.3.4', puerto: 40002, pt: 0, pts: [0, 101] });

// Llamadas contra la central falsa
const espera = ms => new Promise(r => setTimeout(r, ms));
const central = spawn(process.execPath, [fileURLToPath(new URL('../pasarela-telefono/pruebas/central_falsa.mjs', import.meta.url))],
  { env: { ...process.env, SIP_PUERTO: '15070', CONTROL: '15071', USUARIO: '801', CLAVE: 'secreta' }, stdio: 'ignore' });
const ctl = async p => (await fetch('http://127.0.0.1:15071' + p)).json();
try {
  await espera(600);
  // Contraseña equivocada: no registra
  const mala = new TelefoniaSIP({ servidor: '127.0.0.1', puerto: 15070, usuario: '801', clave: 'mal', puertoLocal: 15062, ipPublica: '127.0.0.1' });
  const avisos = []; mala.on('aviso', a => avisos.push(a));
  await mala.revisar(); mala.detener();
  assert.equal(mala.ag, null); assert.ok(avisos.some(a => /usuario o la contraseña/.test(a)), avisos.join(' | '));
  assert.ok(!avisos.join(' ').includes('mal'), 'La contraseña no aparece en los avisos');

  const t = new TelefoniaSIP({ servidor: '127.0.0.1', puerto: 15070, usuario: '801', clave: 'secreta', puertoLocal: 15063, ipPublica: '127.0.0.1', rtpDesde: 41000, rtpHasta: 41020 });
  const ev = []; for (const n of ['equipo', 'llamada', 'estado', 'fin']) t.on(n, x => ev.push([n, x]));
  await t.iniciar();
  assert.ok(t.ag, 'Registrada'); assert.equal((await ctl('/estado')).registrado, true);
  // Entrante: suena, se atiende, viaja audio en los dos sentidos y la central corta
  await ctl('/llamar?num=0981000222'); await espera(400);
  const ll = ev.find(e => e[0] === 'llamada'); assert.equal(ll[1].estado, 'incoming'); assert.equal(ll[1].numero, '0981000222');
  await t.atender(ll[1].ref); await espera(1200);
  assert.equal((await ctl('/estado')).llamada.estado, 'en_curso');
  assert.ok(t.rtpDe(ll[1].ref).recibidos > 10, 'Llega audio de la central');
  assert.ok((await ctl('/estado')).rtpRecibidos > 10, 'Llega audio a la central');
  await ctl('/cortar'); await espera(300);
  assert.ok(ev.some(e => e[0] === 'fin' && e[1].ref === ll[1].ref), 'Fin al cortar la central');
  // Saliente: pide contraseña (407), suena, atiende y la pasarela corta con BYE
  const ref = await t.marcar('+595981000333'); await espera(2200);
  assert.equal((await ctl('/estado')).marcado, '0981000333');
  assert.ok(ev.some(e => e[0] === 'estado' && e[1].ref === ref && e[1].estado === 'alerting'));
  assert.ok(ev.some(e => e[0] === 'estado' && e[1].ref === ref && e[1].estado === 'active'));
  await t.cortar(ref); await espera(400);
  assert.equal((await ctl('/estado')).llamada, null, 'La central recibió el BYE');
  // Saliente cortada mientras suena (CANCEL)
  const ref2 = await t.marcar('0981000444'); await espera(500);
  await t.cortar(ref2); await espera(1800);
  assert.equal((await ctl('/estado')).llamada, null, 'La central recibió el CANCEL');
  assert.ok(ev.some(e => e[0] === 'fin' && e[1].ref === ref2));
  t.detener();
} finally { central.kill(); }
console.log('✔ Pasarela central: G.711, Digest, registro, llamadas entrantes y salientes, cortes y CANCEL.');
