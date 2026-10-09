/* ============ Panel de administración ============ */
import {
  $, $$, esc, S, get, post, patch, put, del, gs, fd, fdate, ago, toast, modal, cerrar,
  confirmar, fx, etapa, vacio, skeleton, ROLES, ORIGENES, vibrar
} from './core.js';
import { modalCargaManual } from './negociaciones.js';
import { tablaCambios } from './colaboracion.js';
import { administrarHorarios } from './horarios.js';

let TADM = 'canales', defs = null, timerQR = null, sucursalesCache = [];

const TABS = [
  ['canales', '📡 Canales'], ['diseno', 'Diseño'], ['sucursales', 'Sucursales'], ['horarios','◷ Horarios laborales'],
  ['botones', '⚡ Botones'], ['flags', 'Funciones ON/OFF'], ['ayudas', '❔ Ayudas guiadas'], ['noti', 'Notificaciones'],
  ['rapidas', 'Respuestas rápidas'], ['usuarios', 'Usuarios'], ['etapas', 'Etapas'], ['reglas', 'Reglas'],
  ['ubicaciones', '📍 Direcciones'], ['stock', 'Stock'], ['bot', 'Bot'],
  ['mensajeria', 'Salud de mensajería'], ['limpieza', 'Limpieza'], ['audit', 'Auditoría']
];

export function irABotones() { TADM = 'botones'; import('./app.js').then(m => m.ir('adm')); }

export async function vistaAdmin() {
  if (S.usuario.rol !== 'admin') {
    $('#view').innerHTML = `<div class="section"><div class="card-box">Acceso restringido al administrador.</div></div>`;
    return;
  }
  if (!defs) defs = await get('/admin/definiciones');
  $('#view').innerHTML = `<div class="section">
    <div class="tabs">${TABS.map(([k, t]) => `<button class="tab ${TADM === k ? 'active' : ''}" data-adm="${k}">${t}</button>`).join('')}</div>
    <div id="adm-body" class="fx-vista">${skeleton(4)}</div></div>`;
  $$('[data-adm]').forEach(b => b.onclick = () => { clearInterval(timerQR); TADM = b.dataset.adm; vistaAdmin(); });
  const fn = { canales: aCanales, diseno: aDiseno, sucursales: aSucursales,
    botones: aBotones, flags: aFlags, ayudas: aAyudas, horarios: administrarHorarios, noti: aNoti, rapidas: aRapidas, usuarios: aUsuarios, etapas: aEtapas,
    reglas: aReglas, ubicaciones: aUbicaciones, stock: aStock, bot: aBot, mensajeria: aMensajeria,
    limpieza: aLimpieza, audit: aAudit }[TADM];
  try { await fn(); } catch (e) { AB().innerHTML = `<div class="card-box">${vacio('⚠', 'No se pudo cargar', e.message)}</div>`; }
}
const AB = () => $('#adm-body');
async function recargarCtx() {
  const ctx = await get('/contexto');
  S.empresa = ctx.empresa; S.sucursales = ctx.sucursales;
}

/* ================= CANALES ================= */
const ICONOS = { whatsapp_qr: ['wa', '📱'], whatsapp_api: ['wapi', '☁️'], messenger: ['fb', '💬'], instagram: ['ig', '📸'] };
const NOMBRES = { whatsapp_qr: 'WhatsApp (QR)', whatsapp_api: 'WhatsApp Cloud API',
  messenger: 'Facebook Messenger', instagram: 'Instagram Direct' };

async function aCanales() {
  const [data, info, sucs] = await Promise.all([
    get('/canales/por-sucursal'), get('/canales/webhook/info'), get('/admin/sucursales')
  ]);
  sucursalesCache = sucs;
  const tarjeta = c => {
    const [cls, ico] = ICONOS[c.tipo] || ['otro', '📨'];
    const color = c.estado === 'conectado' ? 'var(--ok)' : c.estado === 'pendiente' ? 'var(--warn)' : 'var(--bad)';
    return `<div class="canal ${c.estado === 'conectado' ? 'conectado' : ''}"><div class="ico ${cls}">${ico}</div>
      <div style="flex:1;min-width:0"><b>${esc(c.nombre)}</b>
        <small>${NOMBRES[c.tipo]}${c.numero ? ' · ' + esc(c.numero) : ''}${c.linea ? ' · ' + esc(c.linea) : ''}</small>
        <small><span class="dot ${c.estado === 'conectado' ? 'live' : ''}" style="background:${color}"></span>
          ${c.estado === 'conectado' ? 'Conectado' : c.estado === 'pendiente' ? 'Esperando escaneo'
            : c.estado === 'error' ? 'Error de credenciales' : 'Desconectado'}
          ${c.ultima_conexion ? ' · última ' + ago(c.ultima_conexion) + ' atrás' : ''}
          ${!c.activo ? ' · <span style="color:var(--warn)">pausado</span>' : ''}</small>
        ${c.ultimo_error ? `<small style="color:var(--bad)">${esc(String(c.ultimo_error).slice(0, 70))}</small>` : ''}</div>
      <div style="flex:none;display:flex;gap:6px;flex-wrap:wrap">
        ${c.tipo === 'whatsapp_qr'
          ? `<button class="btn sm" data-qr="${c.id}">${c.estado === 'conectado' ? '🔄 Estado' : '📷 Vincular'}</button>`
          : `<button class="btn ghost sm" data-probar="${c.id}">✓ Probar</button>`}
        <button class="btn ghost sm" data-editar="${c.id}">Editar</button>
        <button class="btn danger sm" data-borrar="${c.id}">✕</button></div></div>`;
  };

  AB().innerHTML = `
   <div class="card-box" style="border-color:#2b5a7a">
     <h3>📡 Canales por sucursal</h3>
     <div style="color:var(--muted);font-size:var(--fs-sm);line-height:1.7">
       Cada sucursal tiene sus propios números de WhatsApp y sus redes sociales. Cuando entra un mensaje,
       el sistema lo asigna a un agente <b>de la sucursal dueña del canal</b>, y todo desemboca en el mismo
       tablero con las mismas reglas. Los datos quedan aislados en <b>${esc(S.empresa.nombre)}</b>.</div>
   </div>

   ${data.sucursales.map(s => `<div class="suc-bloque">
     <div class="suc-head"><span style="font-size:20px">🏢</span>
       <div style="flex:1"><b>${esc(s.nombre)}</b><small>${esc(s.ciudad || '')} · ${s.canales.length} canal(es)</small></div>
       <button class="btn sm" data-nuevo-suc="${s.id}">+ Agregar canal</button></div>
     <div class="suc-body">${s.canales.map(tarjeta).join('')
       || vacio('📡', 'Sin canales en esta sucursal', 'Agregá WhatsApp, Messenger o Instagram')}</div></div>`).join('')}

   ${data.sinSucursal.length ? `<div class="suc-bloque">
     <div class="suc-head"><span style="font-size:20px">🌐</span>
       <div style="flex:1"><b>Sin sucursal asignada</b><small>Reparten entre todos los agentes</small></div></div>
     <div class="suc-body">${data.sinSucursal.map(tarjeta).join('')}</div></div>` : ''}

   <div class="card-box"><h3>Agregar canal</h3>
     <div class="grid g4 stagger">
       ${Object.entries(NOMBRES).map(([k, t]) => {
         const [cls, ico] = ICONOS[k];
         return `<button class="card-box" style="margin:0;text-align:left;cursor:pointer" data-nuevo="${k}">
           <div class="ico ${cls}" style="width:42px;height:42px;border-radius:12px;display:grid;place-items:center;font-size:20px;margin-bottom:9px">${ico}</div>
           <b style="font-size:var(--fs-sm);display:block">${t}</b>
           <small style="color:var(--muted);font-size:var(--fs-xs)">
             ${k === 'whatsapp_qr' ? 'Escaneás un QR con el celular. Listo en un minuto.'
               : k === 'whatsapp_api' ? 'Oficial de Meta. Requiere número verificado.'
               : k === 'messenger' ? 'Mensajes de tu página de Facebook.'
               : 'Mensajes directos de tu cuenta de Instagram.'}</small></button>`;
       }).join('')}</div></div>

   <div class="card-box"><h3>🔗 Webhook para los canales de Meta</h3>
     <p class="sub" style="margin-top:0">Pegá estos datos en tu app de Meta → Webhooks → Editar suscripción.</p>
     ${!info.https ? `<div class="card-box" style="border-color:var(--bad);background:var(--surface2)">
       <b style="font-size:var(--fs-sm);color:var(--bad)">⚠ Tu PUBLIC_URL no es HTTPS</b>
       <div style="color:var(--muted);font-size:var(--fs-sm);margin-top:5px">
         Meta rechaza webhooks sin certificado válido. Configurá HTTPS antes de conectar estos canales.</div></div>` : ''}
     <div class="field"><label>URL de callback</label><input value="${esc(info.url)}" readonly id="wh-url"></div>
     <div class="field"><label>Token de verificación</label>
       <input value="${esc(info.verifyToken || '(falta META_VERIFY_TOKEN en el .env)')}" readonly id="wh-tok"></div>
     <div style="display:flex;gap:8px;flex-wrap:wrap">
       <button class="btn ghost sm" id="wh-copiar">📋 Copiar URL</button>
       <button class="btn ghost sm" id="wh-copiar-tok">📋 Copiar token</button></div>
     <div style="color:var(--muted);font-size:var(--fs-xs);margin-top:12px;line-height:1.8">
       Campos a suscribir: <b>WhatsApp Cloud API</b> → messages · <b>Messenger</b> → messages, messaging_postbacks
       · <b>Instagram</b> → messages.
       ${info.tieneSecret ? '<br>✓ App Secret configurado: las firmas se validan.'
         : '<br>⚠ Sin META_APP_SECRET: las firmas no se validan. Configuralo en el .env.'}</div></div>`;

  $$('[data-nuevo]').forEach(b => b.onclick = () => modalCanal(null, b.dataset.nuevo));
  $$('[data-nuevo-suc]').forEach(b => b.onclick = () => modalElegirTipo(b.dataset.nuevoSuc));
  const todos = [...data.sucursales.flatMap(s => s.canales), ...data.sinSucursal];
  $$('[data-editar]').forEach(b => b.onclick = () => modalCanal(todos.find(c => c.id === b.dataset.editar)));
  $$('[data-qr]').forEach(b => b.onclick = () => modalQR(b.dataset.qr));
  $$('[data-probar]').forEach(b => b.onclick = async () => {
    b.disabled = true; b.innerHTML = '<span class="spin"></span>';
    const r = await post(`/canales/${b.dataset.probar}/probar`, {});
    toast(r.ok ? `Credenciales válidas ✓ ${r.nombre || ''}` : (r.error || 'Falló la prueba'), r.ok ? 'ok' : 'bad', 'Canal');
    aCanales();
  });
  $$('[data-borrar]').forEach(b => b.onclick = async () => {
    const c = todos.find(x => x.id === b.dataset.borrar);
    if (!await confirmar('Eliminar canal',
      `Se eliminará <b>${esc(c.nombre)}</b>. Las conversaciones ya recibidas se conservan, pero dejarás de recibir mensajes nuevos por este canal.`,
      'Eliminar')) return;
    await del(`/canales/${c.id}`); toast('Canal eliminado', 'warn'); aCanales();
  });
  $('#wh-copiar').onclick = () => copiar(info.url, 'URL copiada');
  $('#wh-copiar-tok').onclick = () => copiar(info.verifyToken, 'Token copiado');
}

function copiar(txt, msg) {
  if (!txt) return toast('No hay nada que copiar', 'warn');
  navigator.clipboard?.writeText(txt).then(() => toast(msg, 'ok')).catch(() => toast('No se pudo copiar', 'warn'));
}

function modalElegirTipo(sucursalId) {
  modal(`<div class="modal-h"><h3>¿Qué canal querés conectar?</h3><button class="x" data-cerrar>✕</button></div>
   <div class="modal-b"><div class="grid g2 stagger">
     ${Object.entries(NOMBRES).map(([k, t]) => {
       const [cls, ico] = ICONOS[k];
       return `<button class="card-box" style="margin:0;text-align:left;cursor:pointer" data-tipo="${k}">
         <div class="ico ${cls}" style="width:42px;height:42px;border-radius:12px;display:grid;place-items:center;font-size:20px;margin-bottom:9px">${ico}</div>
         <b style="font-size:var(--fs-sm);display:block">${t}</b></button>`;
     }).join('')}</div></div>`);
  $$('[data-cerrar]').forEach(b => b.onclick = cerrar);
  $$('[data-tipo]').forEach(b => b.onclick = () => modalCanal(null, b.dataset.tipo, sucursalId));
}

function modalCanal(c, tipoNuevo, sucursalPre) {
  const tipo = c ? c.tipo : tipoNuevo;
  const cfg = c?.config || {};
  const sucs = sucursalesCache.length ? sucursalesCache : S.sucursales;
  const campos = tipo === 'whatsapp_qr'
    ? `<div class="field"><label>Prefijo de país (para enviar)</label>
         <input id="c-pref" value="${esc(cfg.prefijoPais || S.empresa.reglas?.prefijoPais || '595')}" placeholder="595"></div>
       <div class="card-box" style="background:var(--surface2);margin-top:12px">
         <b style="font-size:var(--fs-sm)">📱 Cómo funciona</b>
         <div style="color:var(--muted);font-size:var(--fs-sm);margin-top:6px;line-height:1.7">
           Al guardar tocás <b>Vincular</b> y escaneás el código desde el celular de esa sucursal.
           La sesión queda guardada en el servidor y se reconecta sola, incluso si nadie tiene el CRM abierto.</div></div>`
    : tipo === 'whatsapp_api'
    ? `<div class="field"><label>Token de acceso permanente *</label>
         <input id="c-token" type="password" autocomplete="off" placeholder="${c ? 'Dejá vacío para conservar el actual' : 'EAAG...'}"></div>
       <div class="row"><div class="field"><label>Phone Number ID *</label>
         <input id="c-phone" value="${esc(cfg.phone_number_id || '')}" placeholder="1234567890"></div>
        <div class="field"><label>WABA ID</label><input id="c-waba" value="${esc(cfg.waba_id || '')}"></div>
        <div class="field"><label>Prefijo de país</label><input id="c-pref" value="${esc(cfg.prefijoPais || '595')}"></div></div>
       <div class="card-box" style="background:var(--surface2);margin-top:12px">
         <b style="font-size:var(--fs-sm)">☁️ Dónde encontrar estos datos</b>
         <div style="color:var(--muted);font-size:var(--fs-sm);margin-top:6px;line-height:1.7">
           En <b>developers.facebook.com</b> → tu app → WhatsApp → Configuración de la API.
           Ahí ves el <i>Phone number ID</i> y podés generar el token. Para producción usá un token
           permanente de usuario del sistema, no el temporal de 24 horas.</div></div>`
    : `<div class="field"><label>Token de acceso de la página *</label>
         <input id="c-token" type="password" autocomplete="off" placeholder="${c ? 'Dejá vacío para conservar el actual' : 'EAAG...'}"></div>
       <div class="row"><div class="field"><label>Page ID ${tipo === 'messenger' ? '*' : ''}</label>
         <input id="c-page" value="${esc(cfg.page_id || '')}"></div>
        ${tipo === 'instagram' ? `<div class="field"><label>Instagram ID *</label>
         <input id="c-ig" value="${esc(cfg.ig_id || '')}"></div>` : ''}</div>
       <div class="card-box" style="background:var(--surface2);margin-top:12px">
         <b style="font-size:var(--fs-sm)">${tipo === 'messenger' ? '💬' : '📸'} Requisitos</b>
         <div style="color:var(--muted);font-size:var(--fs-sm);margin-top:6px;line-height:1.7">
           ${tipo === 'messenger'
             ? 'Página de Facebook y token con permisos <i>pages_messaging</i> y <i>pages_manage_metadata</i>.'
             : 'Cuenta de Instagram <i>Profesional</i> vinculada a una página. Permisos: <i>instagram_manage_messages</i> y <i>pages_manage_metadata</i>.'}
           <br>Además hay que suscribir el webhook (datos abajo en la pestaña Canales).</div></div>`;

  modal(`<div class="modal-h"><h3>${c ? 'Editar' : 'Nuevo'} · ${NOMBRES[tipo]}</h3><button class="x" data-cerrar>✕</button></div>
   <div class="modal-b">
     <div class="row"><div class="field"><label>Nombre interno *</label>
       <input id="c-nom" value="${c ? esc(c.nombre) : ''}" placeholder="Ej: WhatsApp Ventas Central"></div>
      <div class="field"><label>Sucursal dueña del canal</label><select id="c-suc">
        <option value="">Sin sucursal (reparte a todos)</option>
        ${sucs.map(s => `<option value="${s.id}" ${(c?.sucursal_id || sucursalPre) === s.id ? 'selected' : ''}>${esc(s.nombre)}</option>`).join('')}</select></div>
      <div class="field"><label>Línea (opcional)</label><select id="c-linea"><option value="">Todas</option>
        ${(S.empresa.lineas || []).map(l => `<option ${c?.linea === l ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div></div>
     ${campos}
     ${c ? `<label style="display:flex;gap:8px;align-items:center;margin-top:12px;font-size:var(--fs-sm)">
       <span class="sw"><input type="checkbox" id="c-activo" ${c.activo ? 'checked' : ''}><i></i></span> Canal activo</label>` : ''}
     <div class="err" id="c-err"></div></div>
   <div class="modal-f"><button class="btn ghost" data-cerrar>Cancelar</button>
     <button class="btn" id="c-ok">${c ? 'Guardar' : 'Crear canal'}</button></div>`);

  $$('[data-cerrar]').forEach(b => b.onclick = cerrar);
  $('#c-ok').onclick = async () => {
    const body = { tipo, nombre: $('#c-nom').value.trim(), sucursalId: $('#c-suc').value || null, linea: $('#c-linea').value };
    if (!body.nombre) return $('#c-err').textContent = 'El nombre es obligatorio.';
    if ($('#c-token')) body.token = $('#c-token').value.trim();
    if ($('#c-phone')) body.phone_number_id = $('#c-phone').value.trim();
    if ($('#c-waba')) body.waba_id = $('#c-waba').value.trim();
    if ($('#c-page')) body.page_id = $('#c-page').value.trim();
    if ($('#c-ig')) body.ig_id = $('#c-ig').value.trim();
    if ($('#c-pref')) body.prefijoPais = $('#c-pref').value.trim();
    if ($('#c-activo')) body.activo = $('#c-activo').checked;
    const btn = $('#c-ok'); btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Verificando…';
    try {
      if (c) { await patch(`/canales/${c.id}`, body); cerrar(); toast('Canal actualizado', 'ok'); return aCanales(); }
      const r = await post('/canales', body);
      cerrar();
      if (r.prueba && !r.prueba.ok) toast(`Canal creado, pero las credenciales fallaron: ${r.prueba.error}`, 'warn', 'Verificar');
      else toast('Canal creado y verificado ✓', 'ok');
      if (tipo === 'whatsapp_qr') return modalQR(r.canal.id);
      aCanales();
    } catch (e) {
      $('#c-err').textContent = e.data?.error || e.message;
      btn.disabled = false; btn.textContent = c ? 'Guardar' : 'Crear canal';
    }
  };
}

/* ---------- Vinculación por QR ---------- */
async function modalQR(canalId) {
  modal(`<div class="modal-h"><h3>📱 Vincular WhatsApp</h3><button class="x" data-cerrar>✕</button></div>
   <div class="modal-b"><div class="grid g2">
     <div>
       <div id="qr-estado" class="estado-luz"><span class="spin"></span> Iniciando sesión…</div>
       <div class="card-box" style="background:var(--surface2);margin-top:14px">
         <b style="font-size:var(--fs-sm)">Pasos</b>
         <div class="paso"><span class="num">1</span><span style="font-size:var(--fs-sm)">Abrí WhatsApp en el celular de esta sucursal</span></div>
         <div class="paso"><span class="num">2</span><span style="font-size:var(--fs-sm)">Tocá <b>Menú ⋮</b> → <b>Dispositivos vinculados</b></span></div>
         <div class="paso"><span class="num">3</span><span style="font-size:var(--fs-sm)">Tocá <b>Vincular un dispositivo</b></span></div>
         <div class="paso"><span class="num">4</span><span style="font-size:var(--fs-sm)">Escaneá el código de la derecha</span></div></div>
       <div style="color:var(--muted);font-size:var(--fs-xs);margin-top:12px;line-height:1.7">
         El código se renueva solo cada pocos segundos. Una vez vinculado, la sesión queda guardada
         en el servidor: no hace falta volver a escanear aunque reinicies el CRM.</div>
       <div style="margin-top:12px;display:flex;gap:7px;flex-wrap:wrap">
         <button class="btn ghost sm" id="qr-refresh">🔄 Regenerar</button>
         <button class="btn danger sm" id="qr-desvincular">Desvincular</button></div>
     </div>
     <div id="qrbox"><span class="spin lg"></span></div></div></div>`, true);

  const cerrarTodo = () => { clearInterval(timerQR); cerrar(); aCanales(); };
  $$('[data-cerrar]').forEach(b => b.onclick = cerrarTodo);

  const conectar = async () => {
    try { await post(`/canales/${canalId}/conectar`, {}); }
    catch (e) {
      toast(e.message, 'bad', 'WhatsApp');
      const est = $('#qr-estado');
      if (est) est.innerHTML = `<b style="color:var(--bad)">✖ ${esc(e.message)}</b>`;
    }
  };
  await conectar();

  const sondear = async () => {
    try {
      const e = await get(`/canales/${canalId}/qr`);
      const est = $('#qr-estado'), box = $('#qrbox');
      if (!est || !box) { clearInterval(timerQR); return; }
      if (e.estado === 'conectado') {
        clearInterval(timerQR);
        est.innerHTML = `<span class="dot live" style="background:var(--ok)"></span>
          <b style="color:var(--ok)">Conectado${e.numero ? ' · ' + esc(e.numero) : ''}</b>`;
        box.innerHTML = `<div style="text-align:center;color:var(--ok);font-size:64px" class="fx-pop">✓</div>`;
        box.style.background = 'transparent';
        toast('WhatsApp vinculado correctamente', 'ok', 'Canal conectado');
        vibrar([20, 60, 20]);
      } else if (e.qr) {
        est.innerHTML = `<span class="dot live" style="background:var(--warn)"></span> <b>Esperando escaneo…</b>`;
        if (box.dataset.qr !== e.qr) { box.innerHTML = `<img src="${e.qr}" alt="Código QR de WhatsApp">`; box.dataset.qr = e.qr; }
      } else if (e.error) {
        est.innerHTML = `<b style="color:var(--bad)">✖ ${esc(e.error)}</b>`;
      } else {
        est.innerHTML = `<span class="spin"></span> Generando código…`;
      }
    } catch (err) { /* reintenta */ }
  };
  sondear();
  clearInterval(timerQR);
  timerQR = setInterval(sondear, 2500);

  $('#qr-refresh').onclick = conectar;
  $('#qr-desvincular').onclick = async () => {
    if (!await confirmar('Desvincular línea', 'Vas a cerrar la sesión de WhatsApp. Habrá que volver a escanear el QR.', 'Desvincular')) return;
    await post(`/canales/${canalId}/desvincular`, {});
    clearInterval(timerQR); cerrar(); toast('Línea desvinculada', 'warn'); aCanales();
  };
}

/* ================= BOTONES PERSONALIZADOS ================= */
const ACCIONES = [
  { k: 'mensaje', t: 'Insertar mensaje', d: 'Carga un texto en el campo de respuesta' },
  { k: 'catalogo', t: 'Enviar catálogo', d: 'Inserta el link de stock configurado' },
  { k: 'etapa', t: 'Mover de etapa', d: 'Cambia la negociación de columna' },
  { k: 'ubicacion', t: 'Detectar dirección', d: 'Analiza el último mensaje del cliente' },
  { k: 'adjunto', t: 'Adjuntar archivo', d: 'Abre el selector de archivos' }
];
const EMOJIS = ['⚡','📍','📋','✅','⏰','💰','📦','🚚','🎁','📞','💬','🤝','⭐','🔔','📸','🎯','💡','🏷','🧾','🛒'];

async function aBotones() {
  const bs = S.empresa.reglas?.botones || [];
  AB().innerHTML = `<div class="card-box"><h3>⚡ Botones personalizados de la conversación</h3>
   <p class="sub" style="margin-top:0">Accesos rápidos que ven los agentes arriba del campo de mensaje.
     Arrastrá para reordenar. Máximo 12.</p>
   <div id="lista-btns">${bs.map((b, i) => filaBoton(b, i)).join('') || vacio('⚡', 'Sin botones configurados', 'Agregá el primero abajo')}</div>
   <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px">
     <button class="btn sm" id="bt-add">+ Agregar botón</button>
     <button class="btn ghost sm" id="bt-guardar">💾 Guardar cambios</button>
     <button class="btn ghost sm" id="bt-restaurar">Restaurar por defecto</button></div>
   <div class="card-box" style="background:var(--surface2);margin-top:16px">
     <b style="font-size:var(--fs-sm)">Vista previa</b>
     <div class="acciones" id="bt-preview" style="margin-top:10px"></div></div></div>`;
  conectarBotones();
}

function filaBoton(b, i) {
  return `<div class="bpers-edit" data-fila="${i}" draggable="true">
    <span class="arrastre">⠿</span>
    <select data-bicono="${i}" style="width:62px;background:var(--surface2);border:1px solid var(--line);border-radius:8px;padding:8px;font-size:17px">
      ${EMOJIS.map(e => `<option ${b.icono === e ? 'selected' : ''}>${e}</option>`).join('')}</select>
    <input data-btexto="${i}" value="${esc(b.texto || '')}" placeholder="Texto del botón"
      style="flex:1;min-width:110px;background:var(--surface2);border:1px solid var(--line);border-radius:8px;padding:9px">
    <select data-baccion="${i}" style="width:170px;background:var(--surface2);border:1px solid var(--line);border-radius:8px;padding:9px">
      ${ACCIONES.map(a => `<option value="${a.k}" ${b.accion === a.k ? 'selected' : ''}>${a.t}</option>`).join('')}</select>
    <input data-bvalor="${i}" value="${esc(b.valor || '')}" placeholder="${b.accion === 'etapa' ? 'id de etapa' : 'Mensaje a insertar'}"
      style="flex:2;min-width:150px;background:var(--surface2);border:1px solid var(--line);border-radius:8px;padding:9px"
      ${['catalogo','ubicacion','adjunto'].includes(b.accion) ? 'disabled placeholder="(no necesita valor)"' : ''}>
    <input type="color" data-bcolor="${i}" value="${esc(b.color || '#FF7A00')}" style="width:44px;height:38px;border:1px solid var(--line);border-radius:8px;background:var(--surface2)">
    <button class="btn danger sm" data-bdel="${i}">✕</button></div>`;
}

function leerBotones() {
  return $$('[data-fila]').map(f => {
    const i = f.dataset.fila;
    return {
      id: 'b' + i, icono: $(`[data-bicono="${i}"]`).value, texto: $(`[data-btexto="${i}"]`).value.trim(),
      accion: $(`[data-baccion="${i}"]`).value, valor: $(`[data-bvalor="${i}"]`).value.trim(),
      color: $(`[data-bcolor="${i}"]`).value
    };
  });
}

function conectarBotones() {
  const preview = () => {
    const p = $('#bt-preview'); if (!p) return;
    p.innerHTML = leerBotones().map(b =>
      `<span class="bpers" style="--bc:${esc(b.color)}"><span class="em">${esc(b.icono)}</span><span>${esc(b.texto || 'Sin texto')}</span></span>`).join('')
      || '<span style="color:var(--muted);font-size:var(--fs-xs)">Sin botones</span>';
  };
  preview();
  $$('[data-fila] input, [data-fila] select').forEach(el => el.oninput = el.onchange = () => {
    const i = el.closest('[data-fila]').dataset.fila;
    const acc = $(`[data-baccion="${i}"]`).value;
    const val = $(`[data-bvalor="${i}"]`);
    const sinValor = ['catalogo', 'ubicacion', 'adjunto'].includes(acc);
    val.disabled = sinValor;
    val.placeholder = sinValor ? '(no necesita valor)' : acc === 'etapa' ? 'id de etapa (ej: ganado)' : 'Mensaje a insertar';
    preview();
  });
  $$('[data-bdel]').forEach(b => b.onclick = () => {
    const bs = leerBotones(); bs.splice(Number(b.dataset.bdel), 1);
    S.empresa.reglas.botones = bs; aBotones();
  });
  $('#bt-add').onclick = () => {
    const bs = leerBotones();
    if (bs.length >= 12) return toast('Máximo 12 botones', 'warn');
    bs.push({ icono: '⚡', texto: 'Nuevo botón', accion: 'mensaje', valor: '', color: '#FF7A00' });
    S.empresa.reglas.botones = bs; aBotones();
  };
  $('#bt-guardar').onclick = async () => {
    const bs = leerBotones();
    try {
      const r = await put('/admin/botones', { botones: bs });
      S.empresa.reglas.botones = r.botones;
      toast('Botones guardados ✓', 'ok', 'Configuración');
    } catch (e) { toast(e.data?.error || e.message, 'bad'); }
  };
  $('#bt-restaurar').onclick = async () => {
    if (!await confirmar('Restaurar botones', 'Se reemplazarán por los cuatro botones que vienen por defecto.', 'Restaurar', false)) return;
    const def = [
      { id: 'b1', icono: '📍', texto: 'Pedir ubicación', accion: 'mensaje',
        valor: '¿Me compartís tu ubicación para coordinar el envío? Podés mandarla desde el clip 📎 → Ubicación.', color: '#38bdf8' },
      { id: 'b2', icono: '📋', texto: 'Enviar catálogo', accion: 'catalogo', valor: '', color: '#FF7A00' },
      { id: 'b3', icono: '✅', texto: 'Confirmar pedido', accion: 'mensaje',
        valor: '¡Perfecto! Tu pedido quedó confirmado. En breve te paso el detalle del envío.', color: '#22c55e' },
      { id: 'b4', icono: '⏰', texto: 'Pedir un momento', accion: 'mensaje',
        valor: 'Dame un momento por favor, estoy verificando la disponibilidad y te confirmo enseguida.', color: '#f59e0b' }
    ];
    const r = await put('/admin/botones', { botones: def });
    S.empresa.reglas.botones = r.botones; toast('Botones restaurados', 'ok'); aBotones();
  };
  /* reordenar arrastrando */
  let origen = null;
  $$('[data-fila]').forEach(f => {
    f.ondragstart = () => { origen = f; f.classList.add('moviendo'); };
    f.ondragend = () => { f.classList.remove('moviendo'); origen = null; };
    f.ondragover = e => e.preventDefault();
    f.ondrop = e => {
      e.preventDefault();
      if (!origen || origen === f) return;
      const lista = $('#lista-btns');
      const todos = [...lista.children];
      todos.indexOf(origen) < todos.indexOf(f) ? f.after(origen) : f.before(origen);
      const bs = leerBotones();
      S.empresa.reglas.botones = bs; aBotones();
    };
  });
}

/* ================= EMPRESAS ================= */
async function aDiseno() {
  const e = S.empresa;
  AB().innerHTML = `<div class="card-box"><h3>Marca de ${esc(e.nombre)}</h3>
   <div class="impar-lockup" style="max-width:240px"><img src="/assets/impar-logo.jpg" alt="IMPAR"></div>
   <p class="sub">Identidad corporativa IMPAR · Expertos en papel.</p>
   <div class="field"><label>Ciudad base</label><input id="d-ciu" value="${esc(e.ciudad || '')}"></div>
   <div class="field"><label>Módulos habilitados</label><div class="row">
     ${['negociaciones','contactos','comunicacion','calendario','reportes','configuracion'].map(m =>
       `<label style="flex:none;font-size:var(--fs-sm)"><input type="checkbox" data-mod="${m}"
         ${(e.modulos || []).includes(m) ? 'checked' : ''}> ${m}</label>`).join('')}</div></div>
   <div class="field"><label>Líneas de negocio (separadas por coma)</label>
     <input id="d-lin" value="${esc((e.lineas || []).join(', '))}"></div>
   <button class="btn sm" id="d-ok">Guardar</button></div>`;
  $('#d-ok').onclick = async () => {
    await patch('/admin/empresa', {
      ciudad: $('#d-ciu').value.trim(),
      modulos: $$('[data-mod]').filter(c => c.checked).map(c => c.dataset.mod),
      lineas: $('#d-lin').value.split(',').map(s => s.trim()).filter(Boolean)
    });
    await recargarCtx(); toast('Configuración guardada', 'ok');
    import('./app.js').then(m => { m.aplicarMarca(); m.pintarNav(); });
  };
}

/* ================= SUCURSALES ================= */
async function aSucursales() {
  const ss = await get('/admin/sucursales');
  sucursalesCache = ss;
  AB().innerHTML = `<div class="card-box"><h3>Sucursales de ${esc(S.empresa.nombre)}</h3>
   <p class="sub" style="margin-top:-6px">Cada sucursal tiene su ubicación, contacto, horario, responsable y sus propios canales.</p>
   <table><thead><tr><th>Sucursal</th><th class="hide-m">Dirección</th><th>Ciudad</th>
     <th class="hide-m">Contacto</th><th class="hide-m">Responsable</th><th>Personal</th><th>Canales</th><th>Estado</th><th></th></tr></thead>
   <tbody>${ss.map(s => `<tr><td><b>${esc(s.nombre)}</b></td><td class="hide-m">${esc(s.direccion || '—')}</td>
     <td>${esc(s.ciudad || '—')}</td><td class="hide-m">${esc(s.tel || '—')}</td>
     <td class="hide-m">${esc(s.responsable || '—')}</td><td>${s.personal}</td>
     <td>${s.canales_ok}/${s.canales} ${Number(s.canales_ok) ? '<span style="color:var(--ok)">✓</span>' : ''}</td>
     <td>${s.activa ? '<span style="color:var(--ok)">Activa</span>' : '<span style="color:var(--bad)">Inactiva</span>'}</td>
     <td style="text-align:right"><button class="btn ghost sm" data-suc="${s.id}">Editar</button></td></tr>`).join('')}
   </tbody></table>
   <button class="btn sm" style="margin-top:14px" id="s-nueva">+ Nueva sucursal</button></div>`;
  $('#s-nueva').onclick = () => modalSucursal();
  $$('[data-suc]').forEach(b => b.onclick = () => modalSucursal(ss.find(x => x.id === b.dataset.suc)));
}

async function modalSucursal(s) {
  const us = await get('/admin/usuarios');
  modal(`<div class="modal-h"><h3>${s ? 'Editar' : 'Nueva'} sucursal</h3><button class="x" data-cerrar>✕</button></div>
  <div class="modal-b">
   <div class="row"><div class="field"><label>Nombre *</label><input id="su-n" value="${s ? esc(s.nombre) : ''}"></div>
    <div class="field"><label>Ciudad *</label><input id="su-c" value="${s ? esc(s.ciudad || '') : ''}"></div></div>
   <div class="field"><label>Dirección</label><input id="su-d" value="${s ? esc(s.direccion || '') : ''}"></div>
   <div class="row"><div class="field"><label>Latitud</label><input id="su-lat" type="number" step="any" value="${s?.lat ?? ''}"></div>
    <div class="field"><label>Longitud</label><input id="su-lon" type="number" step="any" value="${s?.lon ?? ''}"></div>
    <div class="field"><label>&nbsp;</label><button class="btn ghost" style="width:100%" id="su-geo">📍 Buscar coordenadas</button></div></div>
   <div class="row"><div class="field"><label>Teléfono</label><input id="su-t" value="${s ? esc(s.tel || '') : ''}"></div>
    <div class="field"><label>Email</label><input id="su-e" value="${s ? esc(s.email || '') : ''}"></div>
    <div class="field"><label>Horario</label><input id="su-h" value="${s ? esc(s.horario || '') : '08:00 a 17:00'}"></div></div>
   <div class="field"><label>Responsable</label><select id="su-r"><option value="">—</option>
     ${us.map(u => `<option value="${u.id}" ${s?.responsable_id === u.id ? 'selected' : ''}>${esc(u.nombre)} (${u.rol})</option>`).join('')}</select></div>
   ${s ? `<label style="display:flex;gap:8px;align-items:center;font-size:var(--fs-sm)">
     <span class="sw"><input type="checkbox" id="su-act" ${s.activa ? 'checked' : ''}><i></i></span> Sucursal activa</label>` : ''}
   <div class="err" id="su-err"></div></div>
  <div class="modal-f"><button class="btn ghost" data-cerrar>Cancelar</button>
   <button class="btn" id="su-ok">Guardar</button></div>`);
  $$('[data-cerrar]').forEach(b => b.onclick = cerrar);
  $('#su-geo').onclick = async () => {
    const r = await get(`/admin/geocodificar?ciudad=${encodeURIComponent($('#su-c').value)}`);
    if (r.ok) { $('#su-lat').value = r.lat; $('#su-lon').value = r.lon; toast('Coordenadas encontradas', 'ok'); }
    else toast('No se encontró la ubicación', 'warn');
  };
  $('#su-ok').onclick = async () => {
    const body = {
      nombre: $('#su-n').value.trim(), ciudad: $('#su-c').value.trim(), direccion: $('#su-d').value.trim(),
      lat: $('#su-lat').value !== '' ? Number($('#su-lat').value) : null,
      lon: $('#su-lon').value !== '' ? Number($('#su-lon').value) : null,
      tel: $('#su-t').value.trim(), email: $('#su-e').value.trim(), horario: $('#su-h').value.trim(),
      responsableId: $('#su-r').value || null
    };
    if ($('#su-act')) body.activa = $('#su-act').checked;
    if (!body.nombre || !body.ciudad) return $('#su-err').textContent = 'Nombre y ciudad son obligatorios.';
    try {
      if (s) await patch(`/admin/sucursales/${s.id}`, body);
      else await post('/admin/sucursales', body);
      await recargarCtx(); cerrar(); toast('Sucursal guardada', 'ok'); aSucursales();
    } catch (e) { $('#su-err').textContent = e.data?.error || e.message; }
  };
}

/* ================= FLAGS ================= */
async function aFlags() {
  const f = S.empresa.flags || {};
  AB().innerHTML = `<div class="card-box"><h3>Funciones del sistema · ${esc(S.empresa.nombre)}</h3>
   <p class="sub" style="margin-top:0">Activá o desactivá cualquier característica. Se aplica al instante para todos los usuarios.</p>
   ${defs.flags.map(x => `<div class="flagrow"><div><b>${esc(x.t)}</b><small>${esc(x.d)}</small></div>
     <label class="sw"><input type="checkbox" data-flag="${x.k}" ${f[x.k] ? 'checked' : ''}><i></i></label></div>`).join('')}
   <div style="margin-top:14px;display:flex;gap:8px">
     <button class="btn ghost sm" id="f-todos">Activar todo</button>
     <button class="btn ghost sm" id="f-ninguno">Desactivar todo</button></div></div>`;
  $$('[data-flag]').forEach(el => el.onchange = async () => {
    const r = await patch('/admin/flags', { flags: { [el.dataset.flag]: el.checked } });
    S.empresa.flags = r.flags;
    const d = defs.flags.find(x => x.k === el.dataset.flag);
    toast(`${d.t}: ${el.checked ? 'activado' : 'desactivado'}`, el.checked ? 'ok' : 'warn', 'Configuración');
    import('./app.js').then(m => { m.aplicarFXGlobal(); m.pintarNav(); });
  });
  const todos = async v => {
    const r = await patch('/admin/flags', { flags: Object.fromEntries(defs.flags.map(x => [x.k, v])) });
    S.empresa.flags = r.flags;
    toast(v ? 'Todo activado' : 'Todo desactivado', v ? 'ok' : 'warn'); aFlags();
    import('./app.js').then(m => { m.aplicarFXGlobal(); m.pintarNav(); });
  };
  $('#f-todos').onclick = () => todos(true);
  $('#f-ninguno').onclick = () => todos(false);
}


/* ================= AYUDAS PARA PRINCIPIANTES ================= */
async function aAyudas() {
  const respuesta = await get('/ayudas/config');
  const cfg = respuesta.config;
  const usuarios = respuesta.usuarios;
  const opciones = usuario => [
    ['heredar', 'Según ajuste general'],
    ['mostrar', 'Mostrar ayudas'],
    ['ocultar', 'Ocultar ayudas']
  ].map(([v,t])=>'<option value="'+v+'" '+(usuario.modo===v?'selected':'')+'>'+t+'</option>').join('');
  AB().innerHTML = '<div class="card-box"><h3>❔ Guía interactiva de IMPAR</h3>'+
    '<p class="sub">Las miniayudas explican botones y sectores sin cambiar datos. El recorrido señala las funciones de la pantalla actual.</p>'+
    '<div class="flagrow"><div><b>Ayudas activadas por defecto</b><small>Se aplica a los usuarios sin una excepción personalizada.</small></div>'+
    '<label class="sw"><input id="ga-general" type="checkbox" '+(cfg.general?'checked':'')+'><i></i></label></div>'+
    '<div class="flagrow"><div><b>Mini ayudas (?)</b><small>Agrega iconos explicativos junto a las funciones principales.</small></div>'+
    '<label class="sw"><input id="ga-mini" type="checkbox" '+(cfg.mini_ayudas?'checked':'')+'><i></i></label></div>'+
    '<div class="flagrow"><div><b>Invitación de bienvenida</b><small>Ofrece un recorrido inicial una sola vez por empleado.</small></div>'+
    '<label class="sw"><input id="ga-bienvenida" type="checkbox" '+(cfg.bienvenida?'checked':'')+'><i></i></label></div>'+
    '<div class="guia-admin-estado">Podés activar las ayudas para toda IMPAR y ocultarlas a determinados empleados, o desactivarlas en general y mostrarlas solamente a quienes elijas.</div>'+
    '<div class="guia-admin-filtros"><input id="ga-buscar" placeholder="Buscar empleado o sucursal…" aria-label="Buscar usuario">'+
    '<button class="btn ghost sm" id="ga-heredar">Restablecer todos</button>'+
    '<button class="btn ghost sm" id="ga-todos">Mostrar a todos</button>'+
    '<button class="btn ghost sm" id="ga-ninguno">Ocultar a todos</button></div>'+
    '<div class="guia-admin-usuarios">'+usuarios.map(u=>
      '<label class="guia-admin-usuario" data-ga-nombre="'+esc((u.nombre+' '+(u.sucursal||'')).toLowerCase())+'">'+
      '<span><b>'+esc(u.nombre)+'</b><small>'+esc(u.rol)+' · '+esc(u.sucursal||'Sin sucursal')+'</small></span>'+
      '<select data-ga-usuario="'+esc(u.id)+'">'+opciones(u)+'</select></label>'
    ).join('')+'</div>'+
    '<div class="guia-admin-filtros" style="margin-top:14px"><button class="btn" id="ga-guardar">Guardar configuración</button>'+
    '<button class="btn ghost" id="ga-preview">Vista previa del recorrido</button></div>'+
    '<p class="sub">Para ver cambios en otros equipos, los usuarios conectados actualizan los permisos automáticamente.</p></div>';
  $('#ga-buscar').oninput=e=>{
    const q=e.target.value.trim().toLowerCase();
    $('[data-ga-nombre]').forEach(el=>{el.hidden=!el.dataset.gaNombre.includes(q);});
  };
  $('#ga-heredar').onclick=()=>$('[data-ga-usuario]').forEach(el=>{el.value='heredar';});
  $('#ga-todos').onclick=()=>{ $('#ga-general').checked=true;$('[data-ga-usuario]').forEach(el=>{el.value='heredar';}); };
  $('#ga-ninguno').onclick=()=>{ $('#ga-general').checked=false;$('[data-ga-usuario]').forEach(el=>{el.value='heredar';}); };
  $('#ga-preview').onclick=()=>import('./ayudas.js').then(m=>m.abrirRecorrido(true));
  $('#ga-guardar').onclick=async()=>{
    const btn=$('#ga-guardar');btn.disabled=true;
    const body={
      general:$('#ga-general').checked,
      mini_ayudas:$('#ga-mini').checked,
      bienvenida:$('#ga-bienvenida').checked,
      usuarios:$('[data-ga-usuario]').map(el=>({id:el.dataset.gaUsuario,modo:el.value}))
    };
    try {
      await put('/ayudas/config',body);
      await import('./ayudas.js').then(m=>m.actualizarAyudas());
      toast('Ayudas configuradas y permisos guardados','ok');
      await aAyudas();
    } catch(ex){toast(ex.message,'bad');btn.disabled=false;}
  };
}

/* ================= NOTIFICACIONES ================= */
async function aNoti() {
  const notis = S.empresa.notis || [];
  AB().innerHTML = `<div class="card-box"><h3>Notificaciones personalizadas</h3>
   <p class="sub" style="margin-top:0">Variables:
     <span class="mono">{cliente} {agente} {origen} {origenUsr} {tiempo} {texto} {estado} {monto} {persona} {evento} {fecha} {cantidad} {canal} {direccion}</span></p>
   <table><thead><tr><th>Evento</th><th>Mensaje</th><th>Destinatarios</th><th>Tono</th><th>Activo</th></tr></thead>
   <tbody>${notis.map((n, i) => `<tr><td><b>${esc(n.t)}</b></td>
     <td><input value="${esc(n.msg)}" data-nmsg="${i}" style="width:100%;background:var(--surface2);border:1px solid var(--line);border-radius:8px;padding:7px"></td>
     <td><select data-ndest="${i}" style="background:var(--surface2);border:1px solid var(--line);border-radius:8px;padding:7px">
       ${['agente','agente+jefe','jefe+gerente','gerente','admin','destinatario','agente+jefe+gerente']
         .map(d => `<option ${n.dest === d ? 'selected' : ''}>${d}</option>`).join('')}</select></td>
     <td><select data-ntono="${i}" style="background:var(--surface2);border:1px solid var(--line);border-radius:8px;padding:7px">
       ${['ok','warn','bad'].map(t => `<option ${n.tono === t ? 'selected' : ''}>${t}</option>`).join('')}</select></td>
     <td><label class="sw"><input type="checkbox" data-nv="${i}" ${n.v ? 'checked' : ''}><i></i></label></td></tr>`).join('')}
   </tbody></table>
   <div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap">
     <button class="btn ghost sm" id="n-probar">🔔 Probar</button>
     <button class="btn ghost sm" id="n-restaurar">Restaurar textos</button>
     <button class="btn ghost sm" id="n-permiso">Permitir avisos de escritorio</button></div></div>`;
  const guardar = async () => {
    const lista = notis.map((n, i) => ({ ...n, msg: $(`[data-nmsg="${i}"]`).value, dest: $(`[data-ndest="${i}"]`).value,
      tono: $(`[data-ntono="${i}"]`).value, v: $(`[data-nv="${i}"]`).checked }));
    S.empresa.notis = lista;
    await patch('/admin/notis', { notis: lista });
  };
  $$('[data-nmsg],[data-ndest],[data-ntono],[data-nv]').forEach(el => el.onchange = guardar);
  $('#n-probar').onclick = () => post('/notificaciones/prueba', {});
  $('#n-restaurar').onclick = async () => {
    await patch('/admin/notis', { notis: defs.notis });
    S.empresa.notis = defs.notis; toast('Textos restaurados', 'ok'); aNoti();
  };
  $('#n-permiso').onclick = () => {
    if (!('Notification' in window)) return toast('Tu navegador no soporta notificaciones', 'warn');
    Notification.requestPermission().then(p => toast('Permiso: ' + p, p === 'granted' ? 'ok' : 'warn'));
  };
}

/* ================= RESPUESTAS RÁPIDAS ================= */
async function aRapidas() {
  const [rp, us] = await Promise.all([get('/admin/rapidas'), get('/admin/usuarios')]);
  const sucs = S.sucursales.map(s => s.nombre);
  AB().innerHTML = `<div class="card-box"><h3>⚡ Respuestas rápidas del equipo</h3>
   <p class="sub" style="margin-top:0">Plantillas para los agentes, por empresa o por sucursal. Pueden incluir imagen o archivo.</p>
   <table><thead><tr><th>Texto</th><th>Adjunto</th><th>Alcance</th><th>Autor</th><th></th></tr></thead>
   <tbody>${rp.equipo.map(q => `<tr>
     <td><input value="${esc(q.txt || '')}" data-rtxt="${q.id}" style="width:100%;background:var(--surface2);border:1px solid var(--line);border-radius:8px;padding:7px"></td>
     <td>${q.media_url ? (q.archivo_tipo === 'imagen'
       ? `<img src="${esc(q.media_url)}" style="width:36px;height:36px;object-fit:cover;border-radius:7px" alt="">`
       : '📎') : '—'}</td>
     <td style="width:200px"><select data-ramb="${q.id}" style="width:100%;background:var(--surface2);border:1px solid var(--line);border-radius:8px;padding:7px">
       <option value="empresa" ${q.ambito === 'empresa' ? 'selected' : ''}>Toda la empresa</option>
       ${sucs.map(s => `<option value="suc:${esc(s)}" ${q.ambito === 'sucursal' && q.sucursal === s ? 'selected' : ''}>Sucursal ${esc(s)}</option>`).join('')}</select></td>
     <td>${esc(q.autor || 'Sistema')}</td>
     <td style="text-align:right"><button class="btn danger sm" data-rdel="${q.id}">✕</button></td></tr>`).join('')
     || '<tr><td colspan="5" class="empty">Sin plantillas</td></tr>'}</tbody></table>
   <div class="row" style="margin-top:12px"><input id="ar-t" placeholder="Nueva plantilla…">
     <select id="ar-a" style="max-width:220px;background:var(--surface2);border:1px solid var(--line);border-radius:9px;padding:10px">
       <option value="empresa">Toda la empresa</option>
       ${sucs.map(s => `<option value="suc:${esc(s)}">Sucursal ${esc(s)}</option>`).join('')}</select>
     <button class="btn sm" style="flex:none" id="ar-add">Agregar</button></div>
   <p class="sub" style="margin-top:12px">Para adjuntar imágenes a las plantillas usá el gestor desde la conversación.</p>
   <h3 style="margin-top:18px">Plantillas personales por agente</h3>
   <table><thead><tr><th>Agente</th><th>Sucursal</th><th>Propias</th></tr></thead>
   <tbody>${us.map(u => `<tr><td>${esc(u.nombre)}</td><td>${esc(u.sucursal || '')}</td>
     <td>${(u.rapidas || []).length}</td></tr>`).join('')}</tbody></table></div>`;
  $$('[data-rtxt]').forEach(el => el.onchange = () => patch(`/admin/rapidas/${el.dataset.rtxt}`, { txt: el.value }));
  $$('[data-ramb]').forEach(el => el.onchange = () => {
    const v = el.value;
    patch(`/admin/rapidas/${el.dataset.ramb}`,
      v === 'empresa' ? { ambito: 'empresa' } : { ambito: 'sucursal', sucursal: v.slice(4) });
  });
  $$('[data-rdel]').forEach(b => b.onclick = async () => { await del(`/admin/rapidas/${b.dataset.rdel}`); aRapidas(); });
  $('#ar-add').onclick = async () => {
    const t = $('#ar-t').value.trim(); if (!t) return;
    const v = $('#ar-a').value;
    await post('/admin/rapidas', v === 'empresa' ? { txt: t, ambito: 'empresa' } : { txt: t, ambito: 'sucursal', sucursal: v.slice(4) });
    toast('Plantilla agregada', 'ok'); aRapidas();
  };
}

/* ================= USUARIOS ================= */
async function aUsuarios() {
  const us = await get('/admin/usuarios');
  const sucs = S.sucursales.map(s => s.nombre);
  AB().innerHTML = `<div class="card-box"><h3>Usuarios de ${esc(S.empresa.nombre)}</h3>
   <table><thead><tr><th>Nombre</th><th>Usuario</th><th>Rol</th><th class="hide-m">Sucursal</th>
     <th class="hide-m">Línea</th><th class="hide-m">🎂</th><th>Estado</th><th></th></tr></thead>
   <tbody>${us.map(u => `<tr><td><b>${esc(u.nombre)}</b></td><td class="mono">${esc(u.usuario)}</td>
     <td><select data-rol="${u.id}" style="background:var(--surface2);border:1px solid var(--line);border-radius:7px;padding:5px">
       ${ROLES.map(r => `<option ${u.rol === r ? 'selected' : ''}>${r}</option>`).join('')}</select></td>
     <td class="hide-m"><select data-suc="${u.id}" style="background:var(--surface2);border:1px solid var(--line);border-radius:7px;padding:5px">
       ${sucs.map(s => `<option ${u.sucursal === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></td>
     <td class="hide-m">${esc(u.linea || '')}</td>
     <td class="hide-m">${u.nacimiento ? fd(u.nacimiento) : '<span style="color:var(--warn)">falta</span>'}</td>
     <td>${u.activo ? '<span style="color:var(--ok)">Activo</span>' : '<span style="color:var(--bad)">Inactivo</span>'}</td>
     <td style="text-align:right"><button class="btn ghost sm" data-act="${u.id}" data-v="${u.activo ? 0 : 1}">${u.activo ? 'Bloquear' : 'Activar'}</button>
       <button class="btn ghost sm" data-pass="${u.id}">Clave</button></td></tr>`).join('')}
   </tbody></table>
   <hr style="border:0;border-top:1px solid var(--line);margin:16px 0"><h3>Alta de usuario</h3>
   <div class="row"><div class="field"><label>Nombre</label><input id="u-nom"></div>
     <div class="field"><label>Usuario</label><input id="u-usr"></div>
     <div class="field"><label>Contraseña inicial</label><input id="u-pwd" type="password" value="1234"></div>
     <div class="field"><label>🎂 Nacimiento</label><input id="u-nac" type="date"></div></div>
   <div class="row"><div class="field"><label>Rol</label><select id="u-rol">${ROLES.map(r => `<option>${r}</option>`).join('')}</select></div>
     <div class="field"><label>Sucursal</label><select id="u-suc">${sucs.map(s => `<option>${esc(s)}</option>`).join('')}</select></div>
     <div class="field"><label>Línea</label><select id="u-lin">${(S.empresa.lineas || []).map(s => `<option>${esc(s)}</option>`).join('')}</select></div>
     <div class="field"><label>Jefe</label><select id="u-jef"><option value="">—</option>
       ${us.filter(u => u.rol === 'jefe').map(u => `<option value="${esc(u.usuario)}">${esc(u.nombre)}</option>`).join('')}</select></div></div>
   <button class="btn sm" id="u-crear">Crear usuario</button></div>`;
  $$('[data-rol]').forEach(el => el.onchange = () => patch(`/admin/usuarios/${el.dataset.rol}`, { rol: el.value }).then(() => toast('Rol actualizado', 'ok')));
  $$('[data-suc]').forEach(el => el.onchange = () => patch(`/admin/usuarios/${el.dataset.suc}`, { sucursal: el.value }).then(() => toast('Sucursal actualizada', 'ok')));
  $$('[data-act]').forEach(b => b.onclick = async () => {
    await patch(`/admin/usuarios/${b.dataset.act}`, { activo: b.dataset.v === '1' }); aUsuarios();
  });
  $$('[data-pass]').forEach(b => b.onclick = () => {
    modal(`<div class="modal-h"><h3>Nueva contraseña</h3><button class="x" data-cerrar>✕</button></div>
      <div class="modal-b"><div class="field"><label>Contraseña</label><input id="np" type="password"></div>
      <div class="err" id="np-e"></div></div>
      <div class="modal-f"><button class="btn ghost" data-cerrar>Cancelar</button><button class="btn" id="np-ok">Guardar</button></div>`);
    $$('[data-cerrar]').forEach(x => x.onclick = cerrar);
    $('#np-ok').onclick = async () => {
      try { await post(`/admin/usuarios/${b.dataset.pass}/password`, { password: $('#np').value });
        cerrar(); toast('Contraseña actualizada', 'ok');
      } catch (e) { $('#np-e').textContent = e.data?.error || e.message; }
    };
  });
  $('#u-crear').onclick = async () => {
    try {
      await post('/admin/usuarios', { nombre: $('#u-nom').value.trim(), usuario: $('#u-usr').value.trim(),
        password: $('#u-pwd').value, rol: $('#u-rol').value, sucursal: $('#u-suc').value,
        linea: $('#u-lin').value, equipo: $('#u-jef').value || null, nacimiento: $('#u-nac').value || null });
      toast('Usuario creado', 'ok'); aUsuarios();
    } catch (e) { toast(e.data?.error || e.message, 'bad'); }
  };
}

/* ================= ETAPAS ================= */
async function aEtapas() {
  const e = S.empresa;
  AB().innerHTML = `<div class="grid g2">
   <div class="card-box"><h3>Etapas del pipeline</h3>
    <p class="sub" style="margin-top:-6px">Las etapas <b>activas</b> aplican la regla anti duplicado.
      <b>Cerrado</b> y <b>Cerrado Ganado</b> son terminales y nunca cuentan como abiertas.</p>
    <table><thead><tr><th>Etapa</th><th>Activa</th><th></th></tr></thead>
    <tbody>${(e.etapas || []).map((x, i) => `<tr><td><span class="dot" style="background:${x.color}"></span>
      <input value="${esc(x.nombre)}" data-etn="${i}" style="background:transparent;border:0;width:65%">
      ${x.sistema ? '<span class="badge-rol">sistema</span>' : ''}</td>
      <td><label class="sw"><input type="checkbox" data-eta="${i}" ${x.activa ? 'checked' : ''}><i></i></label></td>
      <td style="text-align:right;white-space:nowrap">
        <button class="btn ghost sm" data-mov="${i}" data-d="-1">↑</button>
        <button class="btn ghost sm" data-mov="${i}" data-d="1">↓</button>
        ${x.sistema ? '' : `<button class="btn danger sm" data-etdel="${i}">✕</button>`}</td></tr>`).join('')}
    </tbody></table>
    <div class="row" style="margin-top:12px"><input id="et-n" placeholder="Nueva etapa">
      <input id="et-c" type="color" value="#7db1ff" style="max-width:60px">
      <button class="btn sm" style="flex:none" id="et-add">Agregar</button></div></div>
   <div class="card-box"><h3>Motivos de cierre</h3>
    <table><tbody>${(e.motivos || []).map((m, i) => `<tr>
      <td><input value="${esc(m)}" data-mot="${i}" style="background:transparent;border:0;width:100%"></td>
      <td style="text-align:right"><button class="btn danger sm" data-motdel="${i}">✕</button></td></tr>`).join('')}</tbody></table>
    <div class="row" style="margin-top:12px"><input id="mo-n" placeholder="Nuevo motivo">
      <button class="btn sm" style="flex:none" id="mo-add">Agregar</button></div></div></div>`;
  const guardarEtapas = async etapas => {
    const r = await patch('/admin/etapas', { etapas });
    S.empresa.etapas = r.etapas || etapas;
  };
  $$('[data-etn]').forEach(el => el.onchange = () => {
    const et = [...S.empresa.etapas]; et[el.dataset.etn].nombre = el.value; guardarEtapas(et);
  });
  $$('[data-eta]').forEach(el => el.onchange = () => {
    const et = [...S.empresa.etapas]; et[el.dataset.eta].activa = el.checked; guardarEtapas(et).then(aEtapas);
  });
  $$('[data-mov]').forEach(b => b.onclick = () => {
    const et = [...S.empresa.etapas], i = Number(b.dataset.mov), j = i + Number(b.dataset.d);
    if (j < 0 || j >= et.length) return;
    [et[i], et[j]] = [et[j], et[i]]; guardarEtapas(et).then(aEtapas);
  });
  $$('[data-etdel]').forEach(b => b.onclick = () => {
    const et = [...S.empresa.etapas]; et.splice(Number(b.dataset.etdel), 1); guardarEtapas(et).then(aEtapas);
  });
  $('#et-add').onclick = () => {
    const n = $('#et-n').value.trim(); if (!n) return;
    guardarEtapas([...S.empresa.etapas,
      { id: 'et_' + Date.now().toString(36), nombre: n, color: $('#et-c').value, sistema: false, activa: true }])
      .then(() => { toast('Etapa agregada', 'ok'); aEtapas(); });
  };
  const guardarMot = async motivos => { await patch('/admin/motivos', { motivos }); S.empresa.motivos = motivos; };
  $$('[data-mot]').forEach(el => el.onchange = () => {
    const m = [...S.empresa.motivos]; m[el.dataset.mot] = el.value; guardarMot(m);
  });
  $$('[data-motdel]').forEach(b => b.onclick = () => {
    const m = [...S.empresa.motivos]; m.splice(Number(b.dataset.motdel), 1); guardarMot(m).then(aEtapas);
  });
  $('#mo-add').onclick = () => {
    const n = $('#mo-n').value.trim(); if (!n) return;
    guardarMot([...S.empresa.motivos, n]).then(aEtapas);
  };
}

/* ================= REGLAS ================= */
async function aReglas() {
  const r = S.empresa.reglas || {};
  AB().innerHTML = `<div class="card-box"><h3>Reglas y tiempos</h3>
   <div class="row"><div class="field"><label>SLA de cierre (horas laborales)</label><input id="r-sla" type="number" value="${r.slaHoras}"></div>
    <div class="field"><label>Aviso previo al SLA (%)</label><input id="r-av" type="number" value="${r.avisoSlaPct}"></div>
    <div class="field"><label>Inicio de jornada</label><input id="r-ji" type="number" value="${r.jornadaIni}"></div>
    <div class="field"><label>Fin de jornada</label><input id="r-jf" type="number" value="${r.jornadaFin}"></div>
    <div class="field"><label>Prefijo de país</label><input id="r-pref" value="${esc(r.prefijoPais || '595')}"></div></div>
   <div class="field"><label>Días hábiles</label><div class="row">
     ${['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'].map((d, i) =>
       `<label style="flex:none;font-size:var(--fs-sm)"><input type="checkbox" data-dia="${i}"
         ${(r.diasHabiles || []).includes(i) ? 'checked' : ''}> ${d}</label>`).join('')}</div></div>
   <button class="btn sm" id="r-ok">Guardar reglas</button>
   <hr style="border:0;border-top:1px solid var(--line);margin:16px 0"><h3>Flujo automático</h3>
   <ul style="color:var(--muted);font-size:var(--fs-sm);line-height:1.9;margin:0;padding-left:18px">
     <li>Los cuatro canales entran por el mismo pipeline, con la sucursal del canal.</li>
     <li><b>Un cliente no puede tener dos negociaciones activas</b>: si escribe de nuevo, el mensaje entra en la existente.</li>
     <li><b>Cerrado Ganado exige el monto de cierre.</b></li>
     <li>Cuando un agente responde, <b>el bot se apaga en esa conversación</b>.</li>
     <li>Las direcciones que manda el cliente se detectan y guardan en su ficha.</li></ul></div>`;
  $('#r-ok').onclick = async () => {
    await patch('/admin/reglas', { reglas: {
      slaHoras: Number($('#r-sla').value) || 24, avisoSlaPct: Number($('#r-av').value) || 70,
      jornadaIni: Number($('#r-ji').value) || 8, jornadaFin: Number($('#r-jf').value) || 17,
      prefijoPais: $('#r-pref').value.trim() || '595',
      diasHabiles: $$('[data-dia]').filter(c => c.checked).map(c => Number(c.dataset.dia))
    }});
    await recargarCtx(); toast('Reglas guardadas', 'ok');
  };
}

/* ================= UBICACIONES ================= */
async function aUbicaciones() {
  const us = await get('/admin/ubicaciones');
  AB().innerHTML = `<div class="card-box"><h3>📍 Direcciones detectadas</h3>
   <p class="sub" style="margin-top:0">El sistema identifica ubicaciones que manda el cliente: GPS del canal,
     enlaces de mapas y direcciones escritas en el mensaje.</p>
   <div class="grid g4" style="margin-bottom:14px">
     <div class="kpi"><span>Total detectadas</span><b>${us.length}</b></div>
     <div class="kpi"><span>Por GPS</span><b class="chico" style="color:var(--ok)">${us.filter(u => u.fuente === 'gps').length}</b></div>
     <div class="kpi"><span>Por enlace</span><b class="chico">${us.filter(u => u.fuente === 'link').length}</b></div>
     <div class="kpi"><span>Escritas</span><b class="chico">${us.filter(u => u.fuente === 'texto').length}</b></div></div>
   <table><thead><tr><th>Cliente</th><th>Dirección</th><th>Fuente</th><th>Confianza</th><th class="hide-m">Fecha</th><th></th></tr></thead>
   <tbody>${us.map(u => `<tr><td><b>${esc(u.cliente)}</b><br><small style="color:var(--muted)">${esc(u.tel || '')}</small></td>
     <td>${esc(u.direccion || u.texto)}</td>
     <td>${u.fuente === 'gps' ? '🛰 GPS' : u.fuente === 'link' ? '🔗 Enlace' : '✍️ Texto'}</td>
     <td><span class="tag ${u.confianza === 'alta' ? 't-wa' : u.confianza === 'media' ? 't-tel' : 't-otro'}">${u.confianza}</span>
       ${u.confirmada ? ' <span style="color:var(--ok)">✓</span>' : ''}</td>
     <td class="hide-m">${fd(u.ts)}</td>
     <td style="text-align:right">${u.lat != null
       ? `<a class="btn ghost sm" href="https://www.google.com/maps/search/?api=1&query=${u.lat},${u.lon}" target="_blank" rel="noopener">🗺</a>` : '—'}</td></tr>`).join('')
     || `<tr><td colspan="6">${vacio('📍', 'Sin direcciones detectadas', 'Aparecerán cuando los clientes las envíen')}</td></tr>`}
   </tbody></table></div>`;
}

/* ================= STOCK / BOT ================= */
async function aStock() {
  const s = S.empresa.stock || {};
  AB().innerHTML = `<div class="card-box"><h3>Stock / Catálogo</h3>
   <p class="sub" style="margin-top:0">Link visible para todos los usuarios. Lo usa el botón «Enviar catálogo».</p>
   <div class="field"><label>Link del catálogo</label><input id="s-link" value="${esc(s.link || '')}" placeholder="https://…"></div>
   <div class="field"><label>Nota interna</label><textarea id="s-nota" rows="2">${esc(s.nota || '')}</textarea></div>
   <button class="btn sm" id="s-ok">Guardar</button>
   ${s.link ? ` <a class="btn ghost sm" href="${esc(s.link)}" target="_blank" rel="noopener">Abrir catálogo</a>` : ''}</div>`;
  $('#s-ok').onclick = async () => {
    await patch('/admin/stock', { stock: { link: $('#s-link').value.trim(), nota: $('#s-nota').value.trim() } });
    await recargarCtx(); toast('Catálogo actualizado', 'ok'); aStock();
  };
}

async function aBot() {
  const b = S.empresa.bot || {};
  AB().innerHTML = `<div class="card-box"><h3>Instrucciones del bot</h3>
   <label style="display:flex;gap:8px;align-items:center;margin-bottom:12px;font-size:var(--fs-sm)">
     <span class="sw"><input type="checkbox" id="b-act" ${b.activo ? 'checked' : ''}><i></i></span>
     Bot activo en la recepción de nuevos contactos</label>
   <div class="card-box" style="background:var(--surface2);margin-bottom:12px">
     <b style="font-size:var(--fs-sm)">🤖 Apagado automático</b>
     <div style="color:var(--muted);font-size:var(--fs-sm);margin-top:5px;line-height:1.7">
       Con «Bot se apaga al responder el agente» activado, apenas una persona escribe el bot deja de
       intervenir en esa negociación. Se reactiva manual desde la ficha o masivamente acá.</div></div>
   <div class="field"><label>Prompt / instrucciones</label>
     <textarea id="b-ins" rows="9">${esc(b.instrucciones || '')}</textarea></div>
   <button class="btn sm" id="b-ok">Guardar instrucciones</button>
   <button class="btn ghost sm" id="b-react">Reactivar bot en todas las abiertas</button></div>`;
  $('#b-ok').onclick = async () => {
    await patch('/admin/bot', { bot: { activo: $('#b-act').checked, instrucciones: $('#b-ins').value } });
    await recargarCtx(); toast('Bot actualizado', 'ok');
  };
  $('#b-react').onclick = async () => {
    const r = await post('/admin/bot/reactivar', {});
    toast(`Bot reactivado en ${r.reactivadas} conversación(es)`, 'ok');
  };
}

/* ================= SALUD DE MENSAJERÍA ================= */
async function aMensajeria() {
  const d = await get('/admin/cuarentena');
  const s = d.stats;
  AB().innerHTML = `<div class="card-box" style="border-color:${Number(s.cuarentena) ? 'var(--bad)' : 'var(--line)'}">
   <h3>🛡 Garantía de ingesta · ningún mensaje se pierde</h3>
   <div class="grid g4" style="margin-bottom:12px">
     <div class="kpi"><span>En cola de proceso</span><b class="chico">${s.pendientes}</b></div>
     <div class="kpi"><span>Procesados</span><b class="chico" style="color:var(--ok)">${s.procesados}</b></div>
     <div class="kpi"><span>En cuarentena</span><b class="chico" style="color:${Number(s.cuarentena) ? 'var(--bad)' : 'var(--ok)'}">${s.cuarentena}</b></div>
     <div class="kpi"><span>Envíos pendientes</span><b class="chico" style="color:${Number(s.cola_salida) ? 'var(--warn)' : 'var(--ok)'}">${s.cola_salida}</b></div></div>
   <div style="color:var(--muted);font-size:var(--fs-sm);line-height:1.8;margin-bottom:12px">
     Cada mensaje entrante se guarda en la base <b>antes</b> de procesarse, con índice único por canal e id externo.
     El worker lo convierte en negociación y recién ahí lo marca como procesado. Si algo falla se reintenta
     3 veces y luego pasa a <b>cuarentena visible</b>: nunca se descarta. Los envíos que fallan quedan en cola
     y se reintentan al reconectar el canal.</div>
   ${Number(s.cuarentena) ? `<table><thead><tr><th>Recibido</th><th>Canal</th><th>De</th><th>Texto</th><th>Error</th><th></th></tr></thead>
     <tbody>${d.mensajes.map(m => `<tr><td>${fdate(m.ts)}</td><td>${esc(m.canal || '—')}</td>
       <td class="mono">${esc(m.remitente)}</td><td>${esc((m.txt || '').slice(0, 50))}</td>
       <td style="color:var(--bad)">${esc(m.error || '—')}</td>
       <td style="text-align:right"><button class="btn ghost sm" data-manual='${esc(JSON.stringify({ nombre: m.nombre, tel: m.remitente, mensaje: m.txt }))}'>Cargar a mano</button></td></tr>`).join('')}
     </tbody></table>
     <button class="btn sm" style="margin-top:12px" id="q-reproc">↻ Reprocesar todo</button>`
    : '<div class="empty">Sin mensajes en cuarentena ✅</div>'}
   ${Number(s.envios_fallidos) ? `<div style="margin-top:14px"><b style="font-size:var(--fs-sm)">
     ${s.envios_fallidos} envío(s) agotaron los reintentos</b>
     <button class="btn ghost sm" style="margin-left:8px" id="o-reint">↻ Reintentar</button></div>` : ''}</div>`;
  if ($('#q-reproc')) $('#q-reproc').onclick = async () => {
    const r = await post('/admin/cuarentena/reprocesar', {});
    toast(`${r.reprocesados} mensaje(s) reprocesados`, 'ok'); aMensajeria();
  };
  if ($('#o-reint')) $('#o-reint').onclick = async () => {
    const r = await post('/admin/outbox/reintentar', {});
    toast(`${r.reencolados} envío(s) reencolados`, 'ok'); aMensajeria();
  };
  $$('[data-manual]').forEach(b => b.onclick = () => {
    const d2 = JSON.parse(b.dataset.manual);
    modalCargaManual({ ...d2, origen: 'whatsapp', motivo: 'Mensaje perdido por el bot' });
  });
}

/* ================= LIMPIEZA / AUDITORÍA ================= */
async function aLimpieza() {
  const dupes = await get('/negociaciones/util/duplicados');
  AB().innerHTML = `<div class="card-box"><h3>🗑 Limpieza de datos</h3>
   <p class="sub" style="margin-top:0">Solo para el administrador y solo dentro de ${esc(S.empresa.nombre)}. Los contactos se conservan.</p>
   <div class="grid g2" style="margin-bottom:12px">
     <div class="kpi"><span>Duplicados activos detectados</span>
       <b style="color:${dupes.length ? 'var(--bad)' : 'var(--ok)'}">${dupes.length}</b></div>
     <div class="kpi"><span>Regla anti duplicado</span>
       <b class="chico" style="color:${fx('antiDuplicado') ? 'var(--ok)' : 'var(--warn)'}">${fx('antiDuplicado') ? 'Activa' : 'Desactivada'}</b></div></div>
   ${dupes.length ? `<button class="btn danger sm" id="l-dup">🧹 Eliminar ${dupes.length} duplicada(s)</button>
     <h3 style="margin-top:16px">Duplicados en etapas activas</h3>
     <table><thead><tr><th>Cliente</th><th>Etapa</th><th>Agente</th><th>Creada</th></tr></thead>
     <tbody>${dupes.map(n => `<tr><td>${esc(n.nombre)}</td><td>${esc(etapa(n.etapa).nombre)}</td>
       <td>${esc(n.agente || '—')}</td><td>${fdate(n.creado)}</td></tr>`).join('')}</tbody></table>`
    : '<div class="empty">Sin duplicados ✅</div>'}</div>`;
  if ($('#l-dup')) $('#l-dup').onclick = async () => {
    if (!await confirmar('Eliminar duplicados',
      `Se eliminarán <b>${dupes.length}</b> negociación(es), conservando la más antigua de cada cliente.`, 'Eliminar')) return;
    await post('/negociaciones/eliminar', { ids: dupes.map(d => d.id), motivo: 'Limpieza de duplicados activos' });
    toast('Duplicados eliminados', 'ok'); aLimpieza();
  };
}

async function aAudit() {
  const rows = await get('/admin/auditoria');
  AB().innerHTML = `<div class="card-box"><h3>Historial de cambios</h3><form id="audit-filtro" class="row"><div class="field"><label for="audit-entidad">Sector</label><select id="audit-entidad"><option value="">Todos</option><option value="negociaciones">Negociaciones</option><option value="contactos">Contactos</option><option value="usuarios">Empleados y accesos</option></select></div><div class="field"><label for="audit-buscar">Usuario o campo</label><input id="audit-buscar" maxlength="100"></div><button class="btn" type="submit">Buscar</button></form><div id="audit-cambios"></div><button class="btn ghost sm" id="audit-mas" hidden>Cargar anteriores</button></div><div class="card-box"><h3>Registro de actividad</h3>
   <table><thead><tr><th>Fecha</th><th>Usuario</th><th>Acción</th><th>Detalle</th><th class="hide-m">IP</th></tr></thead>
   <tbody>${rows.map(a => `<tr><td>${fdate(a.ts)}</td><td>${esc(a.usuario)}</td><td>${esc(a.accion)}</td>
     <td>${esc(a.detalle)}</td><td class="hide-m mono">${esc(a.ip || '')}</td></tr>`).join('')
     || '<tr><td colspan="5" class="empty">Sin registros</td></tr>'}</tbody></table></div>`;
  let cursor=null,busy=false,revision=0;
  const cargar=async(reset=true)=>{
    const box=$('#audit-cambios');if(!box||busy)return;
    busy=true;const version=++revision;
    try{
      const filtro=new URLSearchParams({entidad:$('#audit-entidad').value,q:$('#audit-buscar').value.trim()});
      if(!reset&&cursor)filtro.set('antes',cursor);
      const data=await get('/admin/cambios?'+filtro);
      if($('#audit-cambios')!==box||version!==revision)return;
      if(reset)box.innerHTML=tablaCambios(data.cambios);else box.insertAdjacentHTML('beforeend',tablaCambios(data.cambios));
      cursor=data.siguiente;$('#audit-mas').hidden=!cursor;
    }catch(e){toast(e.message,'bad');}finally{busy=false;}
  };
  $('#audit-filtro').onsubmit=e=>{e.preventDefault();cargar(true);};
  $('#audit-mas').onclick=()=>cargar(false);
  await cargar();
}
