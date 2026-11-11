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
  assert.ok(core.includes("if (canalId && abierta.canal_id !== canalId && !sigueEnWhatsApp)")
    && core.includes("UPDATE negociaciones SET canal_id=$3 WHERE id=$1 AND empresa_id=$2")
    && core.includes('las respuestas salen por esa línea'), 'La negociación reutilizada pasa al canal por el que escribió el cliente');
  console.log('✔ Anti-duplicados: la respuesta sale por la línea a la que escribió el cliente.');
}

// Línea de cada mensaje y de la negociación: «WhatsApp verificado» (Cloud API) o «WhatsApp normal» (QR).
{
  const leer = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
  const core = leer('src/core.mjs'), hist = leer('src/historial-contacto-impar.mjs'), mig = leer('src/migrations/032_linea_mensajes_impar.sql');
  const coreJs = leer('public/js/core.js'), ficha = leer('public/js/ficha.js'), neg = leer('public/js/negociaciones.js'), chat = leer('public/js/chat-mensajes.js');
  assert.ok(mig.includes('ADD COLUMN IF NOT EXISTS canal_id') && !/DELETE\s+FROM|DROP\s/i.test(mig), 'Migración agrega la línea sin borrar nada');
  assert.equal((core.match(/editadoJSON, canalId \|\| null, especial\]/g) || []).length, 2, 'Los mensajes entrantes guardan su línea');
  assert.ok(hist.includes('LEFT JOIN canales cl ON cl.id=COALESCE(m.canal_id,ob.canal_id)'), 'El chat muestra la línea de entrada o de salida');
  const m = await import('../public/js/core.js').catch(() => null);
  const etiquetaLinea = m?.etiquetaLinea || new Function(coreJs.slice(coreJs.indexOf('export function etiquetaLinea')).replace('export ', '') + '; return etiquetaLinea;')();
  assert.equal(etiquetaLinea('whatsapp_api', 'WhatsApp API Impar Papeles').texto, 'WhatsApp verificado');
  assert.equal(etiquetaLinea('whatsapp_api', 'WhatsApp API Impar Papeles').corto, 'Impar Papeles');
  assert.equal(etiquetaLinea('whatsapp_qr', 'principal').texto, 'WhatsApp normal');
  assert.ok(ficha.includes('lineaMensaje(m)') && ficha.includes('${lineaFicha(n)}') && neg.includes('${selloHTML(n)}'), 'Burbujas, ficha y tarjeta muestran la línea');
  assert.ok(chat.includes("(previo.dataset.linea || '') === (el.dataset.linea || '')"), 'Un cambio de línea corta el grupo de mensajes');
  // Una negociación que deja de ser visible (transferida, reasignada, borrada) no queda en pantalla.
{
  const tablero = readFileSync(new URL('../public/js/negociaciones.js', import.meta.url), 'utf8');
  const fichaJs = readFileSync(new URL('../public/js/ficha.js', import.meta.url), 'utf8');
  assert.match(tablero, /if \(e\.status === 404 \|\| e\.status === 403\) quitarTarjetas\(\[id\]\)/, 'la tarjeta se quita al perder acceso');
  assert.doesNotMatch(tablero, /catch \(e\) \{ \/\* pudo haberse borrado \*\/ \}/);
  assert.match(fichaJs, /ya no está a tu cargo, por eso se cerró/, 'la ficha abierta se cierra al perder acceso');
}
console.log('✔ Línea visible: cada mensaje, la ficha y la tarjeta distinguen WhatsApp verificado y normal.');
}
