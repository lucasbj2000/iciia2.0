/** Presencia del equipo: avisa solo cuando cambia algo, a quienes pueden ver la negociación, y caduca sola. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { sseHandler } = await import('../src/realtime.mjs');
const { marcarPresencia, presenciasEmpresa, barrerPresencias, VIDA_MS } = await import('../src/presencia-equipo-impar.mjs');

const E = 'emp-1', recibidos = {};
function conectar(uid) {
  recibidos[uid] = [];
  const req = { empresaId: E, user: { id: uid }, on() {} };
  const res = { writeHead() {}, write(t) { const m = /event: (.+)\ndata: (.+)\n/.exec(t); if (m) recibidos[uid].push({ ev: m[1], d: JSON.parse(m[2]) }); } };
  sseHandler(req, res);
}
for (const u of ['mariela', 'admin', 'intruso']) conectar(u);
const mariela = { id: 'mariela', nombre: 'Mariela Gómez' }, admin = { id: 'admin', nombre: 'Administrador' };

marcarPresencia(E, 'neg-1', mariela, {}, ['mariela', 'admin']);
assert.equal(recibidos.admin.at(-1).ev, 'equipo:viendo');
assert.deepEqual(recibidos.admin.at(-1).d.quienes.map(p => p.id), ['mariela']);
assert.equal(recibidos.intruso.length, 0, 'Quien no puede ver la negociación no recibe nada');

const antes = recibidos.admin.length;
marcarPresencia(E, 'neg-1', mariela, {}, ['mariela', 'admin']);
assert.equal(recibidos.admin.length, antes, 'El latido sin cambios no genera tráfico');

marcarPresencia(E, 'neg-1', mariela, { redactando: true });
assert.equal(recibidos.admin.at(-1).d.quienes[0].redactando, true, 'Avisa que está escribiendo');

marcarPresencia(E, 'neg-1', admin, {}, ['mariela', 'admin']);
assert.deepEqual(Object.keys(presenciasEmpresa(E)), ['neg-1']);
assert.equal(presenciasEmpresa(E)['neg-1'].length, 2);

marcarPresencia(E, 'neg-1', mariela, { salir: true });
assert.deepEqual(recibidos.admin.at(-1).d.quienes.map(p => p.id), ['admin'], 'Al cerrar la ficha se retira');

barrerPresencias(Date.now() + VIDA_MS + 1000);
assert.deepEqual(recibidos.mariela.at(-1).d.quienes, [], 'Una pestaña que dejó de latir caduca sola');
assert.deepEqual(presenciasEmpresa(E), {});
assert.equal(recibidos.intruso.length, 0);

// El cliente sigue siendo privado: la presencia solo lleva nombre y foto del empleado.
const fuente = readFileSync(new URL('../src/presencia-equipo-impar.mjs', import.meta.url), 'utf8');
assert.ok(!/cliente|tel\b|telefono|texto/i.test(fuente.replace(/\/\*[\s\S]*?\*\//g, '')), 'Sin datos del cliente en la presencia');
console.log('✔ Presencia del equipo: avisos solo con cambios, solo a quien puede ver, y caducidad automática.');
process.exit(0);
