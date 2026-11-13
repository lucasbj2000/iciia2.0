#!/usr/bin/env node
/** Programa de la pasarela telefónica: D-Bus de PipeWire (simulado), SSE del CRM y audio en bloques de 10 ms. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Telefonia, objetos } from '../pasarela-telefono/lib/telefonia.mjs';
import { lectorSSE, CRM } from '../pasarela-telefono/lib/crm.mjs';
import { cortadorPCM, aMono } from '../pasarela-telefono/lib/audio.mjs';

/* D-Bus simulado: respuestas con el formato de «busctl --json=short» */
const v = (t, d) => ({ type: t, data: d });
let llamadas = {};
const pedidos = [];
const bus = async args => {
  pedidos.push(args);
  if (args[4] === 'GetManagedObjects' && args[2] === '/org/pipewire/Telephony')
    return { type: 'a{oa{sa{sv}}}', data: [{ '/org/pipewire/Telephony/ag0': { 'org.pipewire.Telephony.AudioGateway1': {} }, ...llamadas }] };
  if (args[4] === 'GetManagedObjects') return { type: 'a{oa{sa{sv}}}', data: [llamadas] };
  return null;
};
const tel = new Telefonia({ bus });
const ev = [];
for (const n of ['equipo', 'llamada', 'estado', 'fin']) tel.on(n, d => ev.push([n, d]));
await tel.revisar();
assert.deepEqual(ev.shift(), ['equipo', { celular: true }]);
llamadas = { '/org/pipewire/Telephony/ag0/call0': { 'org.pipewire.Telephony.Call1': { State: v('s', 'incoming'), LineIdentification: v('s', '0981000111'), Name: v('s', '') } } };
await tel.revisar();
assert.deepEqual(ev.shift(), ['llamada', { ref: '/org/pipewire/Telephony/ag0/call0', estado: 'incoming', numero: '0981000111', nombre: '' }]);
await tel.revisar();
assert.equal(ev.length, 0, 'sin cambios no repite avisos');
llamadas['/org/pipewire/Telephony/ag0/call0']['org.pipewire.Telephony.Call1'].State = v('s', 'active');
await tel.revisar();
assert.deepEqual(ev.shift(), ['estado', { ref: '/org/pipewire/Telephony/ag0/call0', estado: 'active' }]);
llamadas = {};
await tel.revisar();
assert.deepEqual(ev.shift(), ['fin', { ref: '/org/pipewire/Telephony/ag0/call0' }]);
await tel.marcar('+595981000111');
assert.deepEqual(pedidos.at(-1), ['call', 'org.pipewire.Telephony', '/org/pipewire/Telephony/ag0', 'org.pipewire.Telephony.AudioGateway1', 'Dial', 's', '+595981000111']);
await assert.rejects(() => tel.marcar('0981; rm -rf /'), /inválido/);
await tel.atender('/org/pipewire/Telephony/ag0/call1');
assert.deepEqual(pedidos.at(-1).slice(3), ['org.pipewire.Telephony.Call1', 'Answer']);
// Sin servicio de telefonía: avisa una sola vez y queda sin celular
const sin = new Telefonia({ bus: async () => { throw new Error('ServiceUnknown'); } });
const av = []; sin.on('aviso', a => av.push(a)); sin.on('equipo', e => av.push(e));
sin.ag = 'x'; await sin.revisar(); await sin.revisar();
assert.equal(av.filter(a => typeof a === 'string').length, 1);
assert.equal(sin.ag, null);
assert.deepEqual(objetos({ data: [{ '/a': { i: { P: v('s', 'x') } } }] }), { '/a': { i: { P: 'x' } } });
console.log('✓ telefonía por D-Bus: llamadas, estados, fin y marcado');

/* SSE del CRM, con mensajes partidos en cualquier lugar */
const recibidos = [];
const leer = lectorSSE((e, d) => recibidos.push([e, d]));
leer('retry: 3000\n\nevent: cmd\nda'); leer('ta: {"accion":"atender","call_id":"tel.1"}\n'); leer('\nevent: ping\ndata: {}\n\n');
assert.deepEqual(recibidos, [['cmd', '{"accion":"atender","call_id":"tel.1"}'], ['ping', '{}']]);
assert.throws(() => new CRM({ url: 'https://crm.iciia.tech', token: 'malo' }), /PASARELA_TOKEN/);
assert.throws(() => new CRM({ url: '', token: 'pst_' + 'a'.repeat(43) }), /CRM_URL/);
console.log('✓ conexión con el CRM');

/* Audio: bloques exactos de 10 ms a 48 kHz y mezcla a mono */
const bloques = [];
const cortar = cortadorPCM(m => bloques.push(m));
const pcm = Buffer.alloc(960 * 2 + 100);
for (let i = 0; i < pcm.length / 2; i++) pcm.writeInt16LE(i % 1000, i * 2);
cortar(pcm.subarray(0, 333)); cortar(pcm.subarray(333));
assert.equal(bloques.length, 2); assert.ok(bloques.every(b => b.length === 480));
assert.equal(bloques[1][0], 480 % 1000);
const est = aMono({ samples: Int16Array.from([100, 300, -100, -300]), channelCount: 2 });
assert.deepEqual([est.readInt16LE(0), est.readInt16LE(2)], [200, -200]);
console.log('✓ audio en bloques de 10 ms');

const prog = readFileSync('pasarela-telefono/pasarela.mjs', 'utf8');
assert.ok(!/log\([^)]*numero/.test(prog), 'los registros no muestran números');
assert.match(readFileSync('.gitignore', 'utf8'), /pasarela-telefono\/pasarela\.env/, 'el archivo con el token nunca va al repositorio');
console.log('✓ sin números en los registros y token fuera del repositorio');
