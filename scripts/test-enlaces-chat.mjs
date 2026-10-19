/** IMPAR · pruebas aisladas de vínculos en chats (sin datos reales). */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { enlazarTexto } from '../public/js/enlaces.js';

const leer = ruta => readFileSync(new URL('../' + ruta, import.meta.url), 'utf8');
const enlace = (texto, href) => {
  const html = enlazarTexto(texto);
  assert.ok(html.includes('href="' + href + '"'), 'No se enlazó ' + texto + ': ' + html);
  assert.ok(html.includes('target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer"'),
    'El enlace debe abrirse separado del CRM, sin entregar referrer');
  return html;
};

enlace('https://www.impar-papeles.com.py/', 'https://www.impar-papeles.com.py/');
enlace('http://ejemplo.com/ruta', 'http://ejemplo.com/ruta');
enlace('www.ejemplo.com', 'https://www.ejemplo.com/');
enlace('ejemplo.com.py/catalogo.pdf', 'https://ejemplo.com.py/catalogo.pdf');
enlace('maps.app.goo.gl/ejemplo', 'https://maps.app.goo.gl/ejemplo');
enlace('ejemplo@empresa.com.py', 'mailto:ejemplo@empresa.com.py');
enlace('https://ejemplo.com/buscar?q=papel&tipo=2', 'https://ejemplo.com/buscar?q=papel&amp;tipo=2');

const junto = enlazarTexto('Acá está www.ejemplo.com y también https://otro.com/ruta.');
assert.equal((junto.match(/class="enlace-chat"/g) || []).length, 2, 'Detectar varios links');
assert.ok(junto.includes('</a>.'), 'Excluir punto del final de una oración');

const parentesis = enlace('Revisá (https://ejemplo.com/ficha_(v2)).',
  'https://ejemplo.com/ficha_(v2)');
assert.ok(parentesis.includes('</a>).'), 'Conservar paréntesis y punto externos');

const mensaje = enlazarTexto('Primera línea\nSegunda línea: https://ejemplo.com');
assert.ok(mensaje.includes('Primera línea\nSegunda línea: '), 'Mantener saltos de línea');

const xss = enlazarTexto('<img src=x onerror="alert(1)"> y https://ejemplo.com/?x=1&y=2');
assert.ok(!xss.includes('<img'), 'Nunca insertar HTML suministrado por el cliente');
assert.ok(xss.includes('&lt;img') && xss.includes('&quot;alert(1)&quot;'),
  'Escapar HTML y atributos de entrada');
assert.ok(xss.includes('x=1&amp;y=2'), 'Escapar & de atributos href');
assert.ok(!enlazarTexto('javascript:alert(1)').includes('<a'), 'Nunca activar javascript:');
assert.ok(!enlazarTexto('data:text/html,alert(1)').includes('<a'), 'Nunca activar data:');

for (const ruta of ['public/js/ficha.js', 'public/js/modulos.js']) {
  const contenido = leer(ruta);
  assert.ok(contenido.includes("import { enlazarTexto } from './enlaces.js'"),
    ruta + ' debe compartir el enlace seguro');
  assert.ok(contenido.includes('enlazarTexto(m.txt)'), ruta + ' debe mostrar los enlaces');
}
assert.ok(leer('public/js/ficha.js').includes('actualizarMensajes(caja, historialVista.mensajes'),
  'El historial antiguo conserva su render');
assert.ok(leer('public/js/ficha.js').includes('mostrarMensajePendiente'),
  'Los mensajes pendientes conservan su render');
assert.ok(leer('public/chat-amplio.css').includes('.msg a.enlace-chat'),
  'Estilos para los enlaces en ambos chats');
assert.ok(leer('public/index.html').includes('enlaces-20261019'),
  'La publicación debe renovar la caché de los archivos web');
console.log('✔ IMPAR: URLs, catálogos, Mapas y correos clicables; HTML seguro e historial intacto.');
