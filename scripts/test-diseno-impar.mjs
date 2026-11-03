/** IMPAR · Diseño «Expertos en papel», logo adaptable y respuestas rápidas seguras. Sin navegador ni base. */
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
const leer = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const existe = f => existsSync(new URL('../' + f, import.meta.url));
const index = leer('public/index.html'), css = leer('public/impar-diseno.css');

// Capa de diseño al final y fuentes propias (CSP font-src 'self').
const links = [...index.matchAll(/<link rel="stylesheet" href="([^"?]+)/g)].map(m => m[1]);
assert.equal(links.at(-1), '/impar-diseno.css', 'La capa de diseño se carga última');
for (const f of ['figtree-latin-400-normal.woff2', 'figtree-latin-600-normal.woff2', 'nunito-latin-700-normal.woff2', 'LICENCIAS.txt'])
  assert.ok(existe('public/assets/fuentes/' + f), 'Fuente local: ' + f);
assert.ok(!/fonts\.(googleapis|gstatic)/.test(index + css), 'Sin fuentes externas');
assert.ok(css.includes('font-synthesis:none') && !/font-weight:\s*(800|900)/.test(css), 'Pesos acotados');

// Logo sin fondo: capa de color + capa de tinta que sigue el tema.
assert.ok(existe('public/assets/impar-logo-color.png') && existe('public/assets/impar-logo-tinta.png'));
assert.equal((index.match(/class="logo-impar"/g) || []).length, 3, 'Logo en ingreso, carga y menú');
assert.ok(!index.includes('/assets/impar-logo.jpg'), 'Sin el JPG con fondo blanco en pantalla');
assert.ok(css.includes('mask:url(/assets/impar-logo-tinta.png)') && css.includes('.logo-impar{position:relative;display:block;aspect-ratio:678/302;width:100%;color:var(--tinta)}'));

// Lenguaje visual
assert.ok(!index.includes('ATENCIÓN Y VENTAS'), 'Sin rótulos en mayúsculas');
assert.ok(css.includes('--esquina:6px 6px 6px 16px'), 'Esquina IMPAR');
assert.ok(css.includes('#aurora,.btn .brillo{display:none!important}'), 'Sin fondos animados decorativos');
assert.ok(css.includes('backdrop-filter:none!important'), 'Sin vidrio esmerilado');
assert.ok(/small,\.tag,\.ev[^{]*\{font-size:var\(--fs-xs\)!important\}/.test(css) && css.includes('--fs-xs:12px'), 'Piso de 12 px');
assert.ok(css.includes('#cal-prev,#cal-next{min-width:44px;min-height:44px}'), 'Áreas táctiles de 44 px');
assert.ok(css.includes('.tabla-contactos thead{display:none}') && leer('public/js/contactos.js').includes('<table class="tabla-contactos">'), 'Contactos como fichas en el celular');
assert.ok(leer('public/js/app.js').includes("import './tooltips.js';"), 'Tooltips de botones con ícono');
for (const id of ['noti-btn', 'btn-tema', 'btn-install-app', 'btn-salir', 'btn-enlace'])
  assert.ok(new RegExp(`id="${id}"[^>]*aria-label=|aria-label="[^"]+"[^>]*id="${id}"`).test(index), 'Nombre accesible: ' + id);

// Conversación sin atajo manual a WhatsApp Web
const ficha = leer('public/js/ficha.js');
assert.ok(!ficha.includes('f-wa-web') && !ficha.includes('WhatsApp Web (manual)'));

// Respuestas rápidas personales: operaciones por elemento, nunca reemplazo completo.
const admin = leer('src/routes/admin.mjs'), rp = leer('src/rapidas-personales-impar.mjs');
assert.ok(admin.includes("r.post('/rapidas-personales'") && admin.includes("r.patch('/rapidas-personales/:id'") && admin.includes("r.delete('/rapidas-personales/:id'"));
assert.ok(/r\.put\('\/rapidas-personales'[\s\S]{0,120}status\(409\)/.test(admin), 'Una pestaña vieja no puede pisar la lista');
assert.ok(rp.includes("COALESCE(rapidas,'[]'::jsonb) || jsonb_build_array($2::jsonb)"), 'Alta atómica');
assert.ok(!ficha.includes("put('/admin/rapidas-personales'"), 'El navegador ya no envía la lista completa');
console.log('✔ IMPAR: diseño propio, logo adaptable, sin atajo manual y respuestas rápidas sin pérdidas.');
