// Tarjeta del tablero: sello por plataforma, tiempo de espera en horario laboral y urgencia.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
process.env.TZ = 'America/Asuncion';
const src = readFileSync(new URL('../public/js/tarjeta-impar.js', import.meta.url), 'utf8')
  .replace(/^import .*$/gm, '').replace(/^export /gm, '');
const S = { empresa: { reglas: { jornadaIni: 8, jornadaFin: 17, diasHabiles: [1, 2, 3, 4, 5] } }, presencia: {}, usuario: { id: 'yo' } };
const m = new Function('S', 'esc', 'ic', 'get', 'post', 'toast', '$', 'avisarRedaccionTarjeta', 'navigator', 'matchMedia',
  src + '; return { plataforma, llegoPor, selloHTML, minutosLaborales, urgencia, fmtMin };')(
  S, x => String(x), n => `<i data-ic="${n}"></i>`, async () => ({}), async () => ({}), () => {}, () => null, () => {}, { platform: 'Linux' }, () => ({ matches: false }));

// Plataforma y sello
assert.equal(m.plataforma({ canal_tipo: 'whatsapp_api' }).k, 'wv');
assert.equal(m.plataforma({ canal_tipo: 'whatsapp_qr' }).k, 'wn');
assert.equal(m.plataforma({ canal_tipo: 'messenger' }).k, 'ms');
assert.equal(m.plataforma({ canal_tipo: 'instagram' }).k, 'ig');
assert.equal(m.plataforma({ origen: 'manual' }).nombre, 'Manual');
assert.ok(m.selloHTML({ canal_tipo: 'whatsapp_api' }).includes('tj-ver'), 'WhatsApp verificado lleva el check');
assert.ok(!m.selloHTML({ canal_tipo: 'whatsapp_qr' }).includes('tj-ver'), 'WhatsApp normal sin check');
assert.equal(m.llegoPor({ canal_tipo: 'whatsapp_qr', origen: 'instagram' }), 'Instagram', 'Pasó de Instagram a WhatsApp');
assert.equal(m.llegoPor({ canal_tipo: 'instagram', origen: 'instagram' }), '');

// Minutos laborales: la noche y el fin de semana no cuentan
const f = s => new Date(s);
assert.equal(m.minutosLaborales(f('2026-11-11T10:00:00'), f('2026-11-11T10:45:00')), 45);
assert.equal(m.minutosLaborales(f('2026-11-11T16:30:00'), f('2026-11-12T08:30:00')), 60, 'De 16:30 a 8:30 del día siguiente: 1 hora laboral');
assert.equal(m.minutosLaborales(f('2026-11-13T16:00:00'), f('2026-11-16T09:00:00')), 120, 'Viernes 16 h a lunes 9 h: 2 horas');

// Urgencia
const ahora = f('2026-11-11T12:00:00');
const nivel = min => m.urgencia({ etapa: 'espera', entrada_etapa: new Date(ahora - min * 60000) }, ahora).nivel;
assert.deepEqual([nivel(5), nivel(30), nivel(90), nivel(200)], [1, 2, 3, 4], 'Normal, atención, urgente y demorada');
const noche = m.urgencia({ etapa: 'espera', entrada_etapa: f('2026-11-11T21:00:00') }, f('2026-11-11T23:00:00'));
assert.equal(noche.nivel, 0, 'Fuera de horario: espera en pausa');
assert.match(noche.abre, /mañana desde las 08:00/);
assert.equal(m.urgencia({ etapa: 'contactado', entrada_etapa: ahora }, ahora), null, 'Solo cuenta cuando el cliente espera');
S.empresa.reglas.esperaAtencionMin = 5;
assert.equal(nivel(6), 2, 'Los cortes se pueden configurar');
assert.equal(m.fmtMin(125), '2 h 5 min');
console.log('✔ Tarjeta: sellos por plataforma, espera en horario laboral y niveles de urgencia.');
