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
// Una sola pantalla: sin rotación, con mapa real, calor, clima, WhatsApp, tasa de respuesta y agentes en línea.
assert.ok(!sala.includes('ROTA_MS') && sala.includes("e.key === 'Escape' && !document.fullscreenElement"), 'Sin rotación; Esc cierra');
for (const id of ['sala-mapa', 'sala-cola', 'sala-agentes', 'sala-ritmo', 'sala-sucursales', 'sala-clima', 'sala-wa', 'sala-mov'])
  assert.ok(sala.includes(`id="${id}"`), 'Panel ' + id);
assert.ok(salaCss.includes('grid-template-areas:"mapa cola agentes" "mapa ritmo suc"'), 'Todo en una pantalla en PC y TV');
assert.ok(sala.includes("from './planos-ciudades.js'") && !sala.includes('mapa-paraguay'), 'Sucursales con el plano de su distrito');
assert.ok(sala.includes('Respuesta de agentes') && sala.includes('Respuesta del bot') && sala.includes('Agentes en línea') && sala.includes('export function estadoWASala('));
assert.ok(leer('src/sala-control-impar.mjs').includes('export function zonasDeCalor(') && leer('src/sala-control-impar.mjs').includes('Math.round(lat * 10) / 10'), 'Calor agregado en celdas, nunca ubicaciones individuales');
assert.ok(leer('src/routes/varios.mjs').includes("r.get('/sala-control/clima', requiere(...ROLES_SALA)"));
assert.ok(leer('src/realtime.mjs').includes('export const uidsConectados'), 'En línea = CRM abierto de verdad');
assert.ok(index.includes('/sala.css?v='), 'Hoja de estilos de la sala');
assert.ok(salaCss.includes('#sala .sala-logo{width:clamp('), 'El logo de la sala no puede heredar el ancho completo de .logo-impar');
assert.ok(/@media \(prefers-reduced-motion:no-preference\)\{\s*#sala\{animation/.test(salaCss) && !/\n\.sala-[^{]*\{[^}]*animation:sala-/.test(salaCss.split('@media (prefers-reduced-motion:no-preference)')[0]), 'Todo el movimiento de la sala solo sin «reducir movimiento»');
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
// Limpieza: conversación primero, un solo juego de íconos, tarjetas limpias, encabezado liviano.
const fichaJs = leer('public/js/ficha.js'), negJs = leer('public/js/negociaciones.js'), iconos = leer('public/js/iconos.js');
assert.ok(fichaJs.includes('id="f-menu"') && fichaJs.includes('role="menu"') && fichaJs.includes("data-menu=\"historico\""), 'Menú «⋯» en la ficha');
assert.ok(fichaJs.includes('<div id="f-info" class="ficha-info" hidden>'), 'Datos de la negociación fuera del camino');
assert.ok(!fichaJs.includes('Conversación continua del cliente'), 'Sin barra informativa sobre el chat');
assert.ok(/id="f-borrar"/.test(fichaJs) && !fichaJs.includes('btn danger sm" id="f-borrar"'), 'Eliminar vive en el menú, no como botón rojo');
assert.ok(css.includes('.msg [data-hist-tras]{opacity:0') && css.includes('.modo-historico .msg [data-hist-tras]'), '«+ aquí» solo al pasar el mouse');
assert.ok(css.includes('.ficha-etapa{') && !fichaJs.includes('id="f-etapa" style="color:'), 'Etapa con contraste suficiente');
for (const n of ['calendario', 'pin', 'bot', 'clip', 'rayo', 'papelera', 'mas', 'alerta']) assert.ok(iconos.includes(`  ${n}: '`), 'Ícono ' + n);
const pictos = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{26FF}\u{2B50}\u{23F0}-\u{23FA}]/u;
for (const f of ['public/js/negociaciones.js', 'public/js/core.js', 'public/js/adjuntos.js', 'public/js/modulos.js', 'public/js/contactos.js'])
  assert.ok(!pictos.test(leer(f).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')), 'Sin emojis de interfaz en ' + f);
assert.ok(!negJs.includes('>activa</span>') && negJs.includes('card-canal canal-') && negJs.includes('class="card-pie"'), 'Tarjetas limpias');
assert.ok(!/<header class="top">[\s\S]*id="btn-tema"[\s\S]*<\/header>/.test(index) && /class="me-herramientas"[\s\S]*id="btn-tema"/.test(index), 'Tema y aplicación en el área de usuario');
assert.ok(css.includes('body:has(#kanban){background-image:var(--fondo-grano)'), 'Fondo tranquilo detrás del tablero');
assert.ok(css.includes('header.top .wxa,header.top .wxa *{animation-iteration-count:3!important}') && css.includes('.sla.r i{animation:none!important}'), 'Solo lo urgente queda en bucle');
assert.ok(css.includes('--warn:#975A00') && css.includes('.rep-rango button.on{color:var(--sobre-verde)}'), 'Contraste AA en modo claro');
// Segunda ronda: días en el chat, respuestas como botón, caja que crece, filtros, columnas plegadas, menú en grupos.
const chatJs = leer('public/js/chat-mensajes.js');
assert.ok(chatJs.includes('export function etiquetaDia(') && chatJs.includes("return 'Hoy'") && chatJs.includes("return 'Ayer'"), 'Separadores Hoy/Ayer/fecha');
assert.ok(chatJs.includes('separarPorDia(caja);\n  caja.scrollTop'), 'Los separadores se ubican antes de restaurar el scroll');
assert.ok(fichaJs.includes('${horaMensaje(m.ts)}</time>'), 'Burbujas con solo la hora');
assert.ok(chatJs.includes('export function cajaQueCrece(') && fichaJs.includes('<textarea id="msg" rows="1"'), 'Caja de texto que crece');
assert.ok(fichaJs.includes("<summary>${ic('rayo')}<span class=\"sr\">Respuestas y acciones</span></summary>") && css.includes('details.chat-tools[open]>.chat-tools-contenido{position:absolute'), 'Respuestas como botón con panel flotante');
assert.ok(negJs.includes('id="b-filtros"') && negJs.includes('id="filtros-n"') && negJs.includes('function contarFiltros()'), 'Filtros en un botón con contador');
assert.ok(negJs.includes("const TERMINALES = ['ganado', 'cerrado'];") && negJs.includes('data-desplegar') && css.includes('.col.plegada{width:60px}'), 'Columnas cerradas plegadas');
assert.ok(/g: 'Trabajo'[\s\S]*g: 'Seguimiento'[\s\S]*g: 'Gestión'/.test(appJs) && appJs.includes('class="nav-grupo"'), 'Menú lateral en grupos');
for (const f of ['public/js/admin.js', 'public/js/ia.js', 'public/js/datos.js', 'public/js/proyecto.js', 'public/js/catalogos-impar.js', 'public/js/edicion.js', 'public/js/reportes.js', 'public/js/enlaces-impar.js']) {
  // Se conservan solo los emojis que elige el administrador para sus botones y el texto que se envía al cliente.
  const limpio = leer(f).replace(/const EMOJIS = \[[^\]]*\];/, '').replace(/icono: '[^']*'/g, '').replace(/valor: '[^']*'/g, '');
  assert.ok(!pictos.test(limpio), 'Sin emojis de interfaz en ' + f);
}
assert.ok(!fichaJs.includes('RESPUESTAS RÁPIDAS') && css.includes('th,.kpi span,.badge-rol,.cal-h,.org-rol,.pr-eyebrow{text-transform:none!important'), 'Sin rótulos en mayúsculas');
// Fechas sin superponerse y caja visible con el teclado del celular.
assert.ok(css.includes('.dia-sep{display:flex;justify-content:center;margin:12px 0 6px;pointer-events:none}') && !/\.dia-sep\{[^}]*sticky/.test(css), 'Separadores sin pegarse arriba');
assert.ok(chatJs.includes('function actualizarDiaFlotante(') && css.includes('.dia-flotante.on{opacity:1'), 'Un solo rótulo flotante que cambia al desplazarse');
assert.ok(index.includes('interactive-widget=resizes-content'), 'El teclado achica el contenido en Android');
assert.ok(!css.includes('height:100dvh!important') && css.includes('height:var(--crm-viewport-height,100dvh)!important'), 'La ficha usa el alto visible real');
assert.ok(chatJs.includes("window.visualViewport?.addEventListener('resize', () => requestAnimationFrame(ubicar), { once: true })"), 'La caja se ubica al abrir el teclado, sin esperar una tecla');
// Chat más limpio: agrupar, número solo si es otro, inicio de conversación como separador, nombres y canal.
assert.ok(chatJs.includes('function agruparMensajes(') && css.includes('#chatbox .msg.in.g-sigue>small:not(:has(.msg-otro-num)){display:none}'), 'Mensajes seguidos agrupados');
assert.ok(fichaJs.includes('ultimos8(m.remitente_numero) !== ultimos8(actual?.tel)'), 'Número solo si escribe desde otro');
assert.ok(fichaJs.includes(' data-tramo="') && chatJs.includes("t.className = 'tramo-sep'") && !fichaJs.includes('<div class="historial-tramo'), '«Conversación actual» como separador');
assert.ok(fichaJs.includes('function etiquetaCanal(n)'), 'Canal con su tipo');
// Secciones: contactos, comunicación, calendario, reportes, configuración, administración y organigrama.
{
  const contactos = leer('public/js/contactos.js'), mod = leer('public/js/modulos.js'), rep = leer('public/js/reportes.js');
  const adminJs = leer('public/js/admin.js'), org = leer('public/js/organigrama.js'), core = leer('public/js/core.js'), varios = leer('src/routes/varios.mjs');
  assert.ok(contactos.includes('class="contactos-barra') && contactos.includes('class="c-dir"') && !contactos.includes('<th>Dirección</th>'), 'Contactos: barra única y dirección bajo el nombre');
  assert.ok(contactos.includes("n === 1 ? 'cerrada' : 'cerradas'"), 'Contactos: «1 cerrada» en singular');
  assert.ok(mod.includes('BUSCA_COM') && mod.includes('class="ci-n"') && mod.includes('Escribile el primer mensaje a'), 'Comunicación: buscador, sin leer y estado vacío');
  assert.ok(mod.includes("cajaQueCrece(") && mod.includes('!esMovil()'), 'Comunicación: caja que crece y Enter envía en computadora');
  assert.ok(varios.includes("'mio',m.de_id=$2") && !/to_jsonb\(\$(\d)::text\)[\s\S]{0,400}?de_id[<>=]+\$\1\b/.test(varios), 'Comunicación: último mensaje y parámetros uuid/texto separados');
  assert.ok(mod.includes('VISTA_CAL') && mod.includes('details class="cal-aviso"') && mod.includes('data-saludar'), 'Calendario: agenda, aviso compacto y «Saludar»');
  assert.ok(!leer('public/js/animaciones.js').includes('Saludalo'), 'Sin «Saludalo»');
  assert.ok(varios.includes('percentile_cont(0.5)') && rep.includes('Mediana del período'), 'Reportes: primera respuesta como mediana');
  const tiempo = new Function(rep.slice(rep.indexOf('const tiempo ='), rep.indexOf('/** Variación')) + '; return tiempo;')();
  assert.equal(tiempo(14), '14 min'); assert.equal(tiempo(200), '3 h 20 min'); assert.equal(tiempo(13920), '9 días 16 h');
  assert.equal(tiempo(1440 + 1430), '2 días', 'Las horas nunca llegan a 24');
  assert.ok(mod.includes('class="perfil-datos"') && mod.includes('class="marcaciones"'), 'Configuración: datos de solo lectura y marcaciones en lista');
  assert.ok(core.includes('export function mejorarContrasenas(') && core.includes("getModifierState('CapsLock')") && leer('public/js/app.js').includes("mejorarContrasenas($('#login'))"), 'Contraseñas: ver/ocultar y aviso de mayúsculas, también al ingresar');
  assert.ok(adminJs.includes('GRUPOS_ADM') && adminJs.includes('BUSCA_ADM') && adminJs.includes('suc-vacia'), 'Administración: menú agrupado con buscador y sucursales vacías compactas');
  assert.ok(org.includes('org-sin-personal') && org.includes('con-jefe') && org.includes('org-disp'), 'Organigrama: vacías en una línea, jerarquía y disponibilidad');
}
{ // nombreLegible: solo cambia nombres escritos todo en mayúsculas
  const core = leer('public/js/core.js'), ini = core.indexOf('const MENORES'), fin = core.indexOf('export const fd =');
  const f = new Function(core.slice(ini, fin).replace('export function', 'function') + '; return nombreLegible;')();
  assert.equal(f('LILIANA BRITEZ'), 'Liliana Britez');
  assert.equal(f('MARÍA DE LA CRUZ'), 'María de la Cruz');
  assert.equal(f('Juan PÉREZ'), 'Juan PÉREZ', 'Si ya tiene minúsculas no se toca');
  assert.equal(f('595981000111'), '595981000111');
}
console.log('✔ IMPAR: diseño propio, fondo de pliegos, clima animado, logo adaptable y respuestas rápidas sin pérdidas.');
