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

// Fondo «pliegos» (claro y nocturno) solo en el lienzo; datos sobre superficies lisas.
assert.ok(css.includes(':root[data-tema="claro"]{--fondo-marcas:') && /:root,\[data-tema="oscuro"\]\{--fondo-marcas:/.test(css), 'Fondo propio en claro y oscuro');
assert.ok(css.includes('background-image:var(--fondo-marcas),var(--fondo-grano)') && css.includes('border-radius:0 0 0 100%'), 'Marcas de corte, fibra y cuarto de círculo del logo');
assert.ok(/\.card\{background:var\(--surface\)/.test(css) && /\.col\{background:var\(--surface2\)/.test(css), 'Tarjetas y columnas lisas');
// Clima animado, saludo y movimiento con intención; todo quieto con «reducir movimiento».
const clima = leer('public/js/clima-animado.js');
for (const e of ['despejado', 'parcial', 'nublado', 'niebla', 'llovizna', 'lluvia', 'nieve', 'tormenta']) assert.ok(clima.includes(e + ':'), 'Escena ' + e);
assert.ok(leer('public/js/app.js').includes('iconoClima(w.cod)') && leer('public/js/app.js').includes('moverMarcaNav()'));
assert.ok(/@media \(prefers-reduced-motion:no-preference\)\{\s*\.wxa-rayos/.test(css), 'Las animaciones del clima solo corren sin «reducir movimiento»');
assert.ok(/prefers-reduced-motion:reduce\)\{\s*#nav-marca\{transition:none\}/.test(css));
assert.ok(leer('public/js/reportes.js').includes("matchMedia('(prefers-reduced-motion: reduce)').matches) return;"), 'Números quietos con reducir movimiento');

// Conversación sin atajo manual a WhatsApp Web
const ficha = leer('public/js/ficha.js');
assert.ok(!ficha.includes('f-wa-web') && !ficha.includes('WhatsApp Web (manual)'));

// Respuestas rápidas personales: operaciones por elemento, nunca reemplazo completo.
const admin = leer('src/routes/admin.mjs'), rp = leer('src/rapidas-personales-impar.mjs');
assert.ok(admin.includes("r.post('/rapidas-personales'") && admin.includes("r.patch('/rapidas-personales/:id'") && admin.includes("r.delete('/rapidas-personales/:id'"));
assert.ok(/r\.put\('\/rapidas-personales'[\s\S]{0,120}status\(409\)/.test(admin), 'Una pestaña vieja no puede pisar la lista');
assert.ok(rp.includes("COALESCE(rapidas,'[]'::jsonb) || jsonb_build_array($2::jsonb)"), 'Alta atómica');
assert.ok(!ficha.includes("put('/admin/rapidas-personales'"), 'El navegador ya no envía la lista completa');
// Animaciones con intención (sin sello de «Ganada»): todas quietas con «reducir movimiento».
const anim = leer('public/js/animaciones.js');
for (const f of ['volar', 'volarDesde', 'tildesHTML', 'mostrarEscribiendo', 'avisarMensajesNuevos', 'estadoWhatsApp', 'bienvenida', 'guirnalda', 'correr'])
  assert.ok(new RegExp(`export (async )?function ${f}\\(`).test(anim), 'Animación ' + f);
assert.ok(!/sello|ganada/i.test(anim), 'Sin sello de negociación ganada');
assert.ok(leer('src/routes/negociaciones.mjs').includes("r.post('/:id/presencia'"), 'Suscripción a «escribiendo…»');
assert.ok(leer('src/routes/canales.mjs').includes("r.get('/estado-whatsapp'"), 'Estado de WhatsApp sin QR');
assert.ok(!/estado-whatsapp[\s\S]{0,600}\bqr\b/.test(leer('src/routes/canales.mjs')), 'El estado no expone el QR');
assert.ok(leer('src/routes/varios.mjs').includes("r.get('/resumen-dia'"), 'Resumen de la jornada');
assert.ok(leer('src/channels/baileys.mjs').includes("'presence.update'") && leer('src/channels/baileys.mjs').includes('export async function suscribirPresencia'));
// Contenido de todos los bloques «reducir movimiento» (con llaves balanceadas).
const bloquesReducir = hoja => { const out = []; let i = 0;
  while ((i = hoja.indexOf('prefers-reduced-motion:reduce)', i)) >= 0) {
    let j = hoja.indexOf('{', i) + 1, nivel = 1; const ini = j;
    while (nivel && j < hoja.length) { if (hoja[j] === '{') nivel++; else if (hoja[j] === '}') nivel--; j++; }
    out.push(hoja.slice(ini, j - 1)); i = j; }
  return out.join('\n'); };
const reducir = bloquesReducir(css);
for (const sel of ['.escribiendo-flotante', '#disp-dot.live::after', '.toast-tiempo', '.rep-chart svg.entra', '#wa-estado.on'])
  assert.ok(reducir.includes(sel), 'Quieto con reducir movimiento: ' + sel);
assert.ok((anim.match(/menosMovimiento\(\)/g) || []).length >= 4, 'Vuelo de tarjetas, bienvenida y contadores respetan reducir movimiento');
// Sala de control: solo mando, en vivo, sin datos completos de clientes.
const sala = leer('public/js/sala-control.js'), salaCss = leer('public/sala.css'), appJs = leer('public/js/app.js');
assert.ok(appJs.includes("{ id: 'sala', t: 'Sala de control'") && appJs.includes("n.sala ? ['admin','gerente','jefe'].includes(S.usuario.rol)"), 'Sala visible solo para mando');
assert.ok(leer('src/routes/varios.mjs').includes("r.get('/sala-control', requiere(...ROLES_SALA)"), 'El servidor exige rol de mando');
assert.ok(leer('src/sala-control-impar.mjs').includes("export const ROLES_SALA = ['admin', 'gerente', 'jefe'];"));
assert.ok(/emitir\(empresaId, 'sala:pulso', \{ sucursal: rows\[0\]\.sucursal \|\| '', tipo \}, uids\)/.test(leer('src/sala-control-impar.mjs')), 'El pulso solo lleva sucursal y tipo');
assert.ok(leer('src/sala-control-impar.mjs').includes('if (!rows[0] || !uids.length) return;'), 'Sin destinatarios no se difunde a todos');
for (const v of ["id: 'mapa'", "id: 'cola'", "id: 'ritmo'"]) assert.ok(sala.includes(v), 'Vista ' + v);
assert.ok(sala.includes('ROTA_MS = 30000') && sala.includes("e.key === 'Escape' && !document.fullscreenElement"), 'Rota cada 30 s y cierra con Esc');
assert.ok(index.includes('/sala.css?v='), 'Hoja de estilos de la sala');
assert.ok(salaCss.includes('#sala .sala-logo{width:clamp('), 'El logo de la sala no puede heredar el ancho completo de .logo-impar');
assert.ok(/prefers-reduced-motion:reduce\)\{\s*\.sala-progreso i\.corre\{animation:none/.test(salaCss), 'Sala quieta con reducir movimiento');
assert.ok(leer('src/core.mjs').includes("pulsoSala(empresa.id, abierta.id, 'mensaje')") && leer('src/core.mjs').includes("pulsoSala(empresa.id, neg.id, 'nuevo')"));
assert.ok(leer('src/routes/negociaciones.mjs').includes("pulsoSala(req.empresaId, n.id, 'venta')") && leer('src/routes/negociaciones.mjs').includes("pulsoSala(req.empresaId, n.id, 'respuesta')"));
// Transiciones de papel y ficha que se despliega desde su tarjeta.
assert.ok(anim.includes('export function pasarHoja(') && anim.includes('Promise.race([p.catch(() => {}), espera(420)])'), 'La hoja nunca congela más de 420 ms');
assert.ok(appJs.includes('pasarHoja(render, sentido)'), 'Cambio de sección con hoja');
assert.ok(css.includes('#view{view-transition-name:impar-hoja}') && css.includes('@keyframes hoja-despliega'));
assert.ok(leer('public/js/negociaciones.js').includes('desplegarDesde(desde)') && leer('public/js/core.js').includes('window._hojaModal?.()'));
assert.ok(/prefers-reduced-motion:reduce\)\{\s*::view-transition-group\(\*\)/.test(css), 'Sin pliegues con reducir movimiento');
// Presencia del equipo.
const pres = leer('public/js/presencia-equipo.js');
assert.ok(leer('src/routes/negociaciones.mjs').includes("r.post('/:id/viendo'") && leer('src/routes/negociaciones.mjs').includes("r.get('/presencia-equipo'"));
assert.ok(leer('src/routes/negociaciones.mjs').indexOf("r.get('/presencia-equipo'") < leer('src/routes/negociaciones.mjs').indexOf("r.get('/:id'"), 'La ruta fija va antes que /:id');
assert.ok(pres.includes('keepalive: true') && pres.includes("window.addEventListener('pagehide'"), 'Se retira aunque se cierre la pestaña');
assert.ok(pres.includes('Coordinen antes de responder'), 'Aviso de coordinación al escribir');
assert.ok(appJs.includes("es.addEventListener('equipo:viendo'"));
console.log('✔ IMPAR: diseño propio, fondo de pliegos, clima animado, logo adaptable y respuestas rápidas sin pérdidas.');
