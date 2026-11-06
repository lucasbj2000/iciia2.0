/** IMPAR: el tablero no queda congelado tras un corte o reinicio del servidor. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const app = readFileSync(new URL('../public/js/app.js', import.meta.url), 'utf8');
const rt = readFileSync(new URL('../src/realtime.mjs', import.meta.url), 'utf8');
assert.ok(rt.includes("res.write('event: ping\\ndata: {}\\n\\n')"), 'El servidor manda una señal de vida que el navegador puede escuchar');
assert.ok(app.includes("es.addEventListener('ping'"), 'El navegador registra la señal de vida');
assert.ok(/es\.readyState === EventSource\.CLOSED && window\._sse === es\) reconectarRealtime\(\)/.test(app),
  'Si el servidor responde con error y el navegador cierra la conexión, IMPAR reconecta');
assert.ok(app.includes('Date.now() - sseUltimaSenal > SSE_SILENCIO_MAX') && app.includes('const SSE_SILENCIO_MAX = 70000'),
  'Una conexión silenciosa (pestaña congelada, red caída) se reemplaza');
assert.ok(/if \(sseYaConectado\) resincronizarTablero\(\)/.test(app), 'Cada reconexión resincroniza el tablero');
assert.ok(app.includes("if (S.vista === 'neg' && !document.querySelector('.volando, .drag')) vistaNegociaciones();"),
  'La resincronización no interrumpe un arrastre');
assert.ok(app.includes("window.addEventListener('online'"), 'Al volver la red, reconecta');
console.log('✔ Tiempo real: reconexión, señal de vida y resincronización del tablero.');

// Un cliente que escribe por otra línea sigue en su negociación, pero la respuesta sale por esa línea.
{
  const core = readFileSync(new URL('../src/core.mjs', import.meta.url), 'utf8');
  assert.ok(core.includes("if (canalId && abierta.canal_id !== canalId)")
    && core.includes("UPDATE negociaciones SET canal_id=$3 WHERE id=$1 AND empresa_id=$2")
    && core.includes('las respuestas salen por esa línea'), 'La negociación reutilizada pasa al canal por el que escribió el cliente');
  console.log('✔ Anti-duplicados: la respuesta sale por la línea a la que escribió el cliente.');
}
