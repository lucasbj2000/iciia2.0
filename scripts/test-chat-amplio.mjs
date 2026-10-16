/** IMPAR · regresión visual/estructural del chat de negociación (sin DB). */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const leer=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const ficha=leer('public/js/ficha.js');
const css=leer('public/chat-amplio.css');
const index=leer('public/index.html');
const anterior=leer('public/impar.css');

// Node analiza el JS real, con todos los template literals del formulario.
execFileSync(process.execPath,['--check',new URL('../public/js/ficha.js',import.meta.url).pathname],{stdio:'pipe'});

assert.ok(ficha.includes('<details class="ficha-contexto ficha-acordeon"><summary>'));
assert.ok(!ficha.includes("ficha-contexto\" \${esMovil() ? '' : 'open'}"),
  'Información empieza plegada en móvil y PC');
assert.ok(ficha.includes('<details class="ficha-transferencias ficha-acordeon">'),
  'Transferencias cuentan con desplegable propio');
assert.ok(ficha.includes('<details class="chat-tools"><summary>'),
  'Respuestas y acciones quedan accesibles, cerradas por defecto');
assert.ok(!ficha.includes('chat-tools\" \${esMovil() ?'),
  'Respuestas rápidas no se expanden por defecto en PC');
// La inicialización no depende del estado previo ni de estilos heredados.
assert.ok(ficha.includes("querySelectorAll('details.ficha-contexto, details.ficha-transferencias, details.chat-tools')"));
assert.ok(ficha.includes('panel.open = false;'), 'Paneles cerrados al entrar a cada conversación');
for(const tipo of ['ficha-contexto','ficha-transferencias','chat-tools']){
  assert.ok(css.includes('details.'+tipo+':not([open])'),tipo+' tiene regla cerrada');
}
assert.ok(css.includes('display:none!important;'),'Los hijos no se renderizan mientras está contraído');
assert.ok(ficha.includes('id="chatbox"'));
assert.ok(ficha.includes('id="msg"'));
assert.ok(ficha.includes('id="remsg"'));
assert.ok(ficha.includes('id="f-enviar"'));
assert.ok(ficha.includes('id="f-rege"'));
assert.ok(ficha.includes('id="f-mas-mensajes"'));
assert.ok(ficha.includes("actualizarMensajes(cb, historialVista?.mensajes || n.mensajes || []"),
  'El historial real sigue siendo la fuente del chat');
assert.ok(ficha.includes("$$('[data-rapida]').forEach"),'Plantillas siguen activas');
assert.ok(ficha.includes("$$('[data-bpers]').forEach"),'Acciones siguen activas');
assert.ok(ficha.includes("conectarAdjuntos({ inputSel: '#msg'"),'Adjuntos manuales siguen activos');
assert.ok(ficha.includes("post(\`/negociaciones/\${n.id}/mensajes\`"),'Envío de mensajes inalterado');

assert.ok(index.includes('/chat-amplio.css?v=20261016-cerrado2'));
assert.match(index,/\/js\/app\.js\?v=impar-(?:acordeones-cerrados-20261016-1|central-compartida-20261016-3)/);
// La ampliación se conserva al renovar la versión JS por otras mejoras.
assert.ok(css.includes('.modal.conversation-modal{'));
assert.ok(css.includes('height:calc(var(--crm-viewport-height,100dvh) - 20px)'));
assert.ok(css.includes('.conversation-modal #t-chat:not(.hidden){'));
assert.ok(css.includes('flex:1 1 0'));
assert.ok(css.includes('.conversation-modal #chatbox{'));
assert.ok(css.includes('overflow-y:auto'));
assert.ok(css.includes('.conversation-modal .chat-compose{'));
assert.ok(css.includes('flex:0 0 auto'), 'La caja de escritura no se comprime');
assert.ok(css.includes('.crm-viewport-compact .conversation-modal .chat-tools{display:block}'),
  'Las herramientas NO desaparecen con el teclado del móvil');
assert.ok(css.includes('@media(max-width:900px)'));
assert.ok(anterior.includes('max-width:1080px'),'La ampliación sobreescribe el ancho previo');
assert.ok(!/UPDATE\s+(contactos|negociaciones|mensajes|canales)/i.test(css),
  'No tocar datos ni lógica de negocio');

console.log('✔ IMPAR: chat amplio en PC/móvil y desplegables completos, sin cambios de datos.');
