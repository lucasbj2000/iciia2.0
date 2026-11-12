#!/usr/bin/env node
/** Reparación del cifrado con un cliente (línea WhatsApp normal): solo su sesión, nunca la vinculación. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { usuarioSignal, sesionesDeUsuarios, registrarFalla } from '../src/wa-cifrado-impar.mjs';

assert.equal(usuarioSignal('595972244715@s.whatsapp.net'), '595972244715');
assert.equal(usuarioSignal('123456789012345:7@lid'), '123456789012345');
assert.equal(usuarioSignal('grupo@g.us'), '');
assert.equal(usuarioSignal(''), '');

const archivos = ['creds.json', 'session-595972244715.0.json', 'session-595972244715.12.json', 'session-123456789012345.0.json',
  'session-595981000001.0.json', 'pre-key-5.json', 'app-state-sync-key-AAA.json', 'session-5959722447150.0.json'];
assert.deepEqual(sesionesDeUsuarios(archivos, new Set(['595972244715', '123456789012345'])).sort(),
  ['123456789012345.0', '595972244715.0', '595972244715.12'], 'solo las sesiones de ese cliente (número y LID)');
assert.deepEqual(sesionesDeUsuarios(archivos, new Set([''])), [], 'sin usuario no se borra nada');
assert.ok(!sesionesDeUsuarios(archivos, new Set(['595972244715'])).some(x => x.startsWith('5959722447150')), 'no confunde números parecidos');
console.log('✓ elige solo las sesiones del cliente');

const est = {}, t0 = 1_000_000_000_000;
assert.equal(registrarFalla(est, '595972244715', t0), false, 'una sola falla no repara');
assert.equal(registrarFalla(est, '595972244715', t0 + 60e3), true, 'dos fallas en 30 min reparan');
assert.equal(registrarFalla(est, '595972244715', t0 + 120e3), false);
assert.equal(registrarFalla(est, '595972244715', t0 + 180e3), false, 'no repite antes de 2 horas');
assert.equal(registrarFalla(est, '595981000001', t0), false);
assert.equal(registrarFalla(est, '595981000001', t0 + 31 * 60e3), false, 'fallas separadas por más de 30 min no suman');
assert.equal(registrarFalla(est, '', t0), false);
console.log('✓ reparación automática con umbral y pausa');

const bai = readFileSync('src/channels/baileys.mjs', 'utf8');
assert.match(bai, /fallaCifrado\(canal,de,'mensaje_no_leido_por_cliente'\)/, 'recibo «retry» cuenta como falla');
assert.match(bai, /fallaCifrado\(canal,m\.key\?\.remoteJid,'mensaje_del_cliente_ilegible'\)/, 'mensaje ilegible cuenta como falla');
assert.match(bai, /authState\.keys\.set\(\{session:/, 'borra solo claves de sesión');
assert.ok(!/rmSync\([^)]*session/.test(bai), 'nunca borra la carpeta de vinculación por esto');
assert.ok(!/\[wa:cifrado\][^\n]*\$\{(jid|numero|de)\}/.test(bai), 'los logs no muestran números');
const neg = readFileSync('src/routes/negociaciones.mjs', 'utf8');
assert.match(neg, /r\.post\('\/:id\/reparar-whatsapp', requiere\(\)/);
assert.match(neg, /obtenerNegociacionVisible\(req, req\.params\.id\)[\s\S]{0,200}whatsapp_qr/, 'solo negociaciones visibles de la línea QR');
const ficha = readFileSync('public/js/ficha.js', 'utf8');
assert.match(ficha, /data-menu="reparar-wa"/);
assert.match(ficha, /data-reparar-wa/);
console.log('✓ reparación conectada en la línea normal y en la ficha');
