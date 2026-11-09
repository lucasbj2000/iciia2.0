/* IMPAR · «Conectar con Facebook»: Messenger e Instagram sin copiar tokens.
   El usuario inicia sesión en la ventana de Facebook; el CRM nunca ve la contraseña. */
import { $, $$, esc, get, post, put, toast, modal, cerrar } from './core.js';
import { ic } from './iconos.js';

let sondeo = null, canalAviso = null;

export async function pintarMetaLogin(caja, { sucursales = [], alTerminar } = {}) {
  if (!caja) return;
  let a;
  try { a = await get('/meta-login/ajustes'); }
  catch (e) { caja.innerHTML = ''; return; }
  const copiar = (id, valor) => `<div class="ml-copia"><input id="${id}" readonly value="${esc(valor)}" aria-label="Valor para copiar"><button class="btn ghost sm" type="button" data-copiar="${id}">Copiar</button></div>`;
  caja.innerHTML = `<div class="card-box ml-caja">
    <div class="ml-cab"><div>
      <h3>${ic('mensaje')} Facebook e Instagram</h3>
      <p class="sub">Iniciás sesión en la ventana de Facebook, elegís la página de IMPAR y su Instagram, y el CRM crea los canales. La contraseña se escribe solo en Facebook.</p></div>
      ${a.configId ? `<button class="btn" id="ml-conectar" type="button">${ic('mensaje')} Conectar con Facebook</button>` : ''}</div>
    ${!a.tieneSecret ? '<p class="ml-alerta">Falta META_APP_SECRET en el servidor: sin eso Facebook no puede devolver el acceso.</p>' : ''}
    <details class="ml-ajustes" ${a.configId ? '' : 'open'}>
      <summary>${a.configId ? 'Configuración de Meta' : 'Primero: configurar el inicio de sesión en Meta (una sola vez)'}</summary>
      <ol>
        <li>En <b>developers.facebook.com</b> → app <b>IMPAR CRM</b> → <b>Inicio de sesión con Facebook para empresas</b> → <b>Configuración</b>, pegá esta dirección en «URI de redireccionamiento de OAuth válidos»:
          ${copiar('ml-redirect', a.redirect)}</li>
        <li>En <b>Configuraciones</b> → <b>Crear configuración</b>: tipo de token <b>Token de acceso de usuario</b>, y los permisos
          <i>pages_show_list, pages_manage_metadata, pages_messaging, pages_read_engagement, business_management, instagram_basic, instagram_manage_messages</i>.</li>
        <li>Copiá el <b>ID de configuración</b> que te da Meta y pegalo acá:
          <div class="ml-copia"><input id="ml-config" inputmode="numeric" value="${esc(a.configId)}" placeholder="Ej.: 1234567890123456" aria-label="ID de configuración de Meta">
          <button class="btn sm" type="button" id="ml-guardar">Guardar</button></div></li>
      </ol>
      <p class="sub">App de Meta: ${esc(a.appId)}${a.https ? '' : ' · <b>el CRM tiene que abrirse con https</b>'}</p>
    </details></div>`;
  $$('[data-copiar]', caja).forEach(b => b.onclick = async () => {
    const i = $('#' + b.dataset.copiar, caja);
    try { await navigator.clipboard.writeText(i.value); toast('Copiado', 'ok'); } catch { i.select(); }
  });
  $('#ml-guardar', caja).onclick = async () => {
    try { await put('/meta-login/ajustes', { configId: $('#ml-config', caja).value.trim() }); toast('Configuración guardada', 'ok', 'Facebook'); pintarMetaLogin(caja, { sucursales, alTerminar }); }
    catch (e) { toast(e.data?.error || e.message, 'bad', 'Facebook'); }
  };
  if ($('#ml-conectar', caja)) $('#ml-conectar', caja).onclick = () => abrirLogin({ sucursales, alTerminar });
}

async function abrirLogin({ sucursales, alTerminar }) {
  // La ventana se abre en el mismo clic (si no, el navegador la bloquea) y después se le da la dirección.
  const ventana = window.open('about:blank', 'impar-facebook', 'width=620,height=760');
  let inicio;
  try { inicio = await post('/meta-login/iniciar', {}); }
  catch (e) { ventana?.close(); return toast(e.data?.error || e.message, 'bad', 'Facebook'); }
  if (ventana && !ventana.closed) ventana.location.href = inicio.url;
  else {
    modal(`<div class="modal-h"><h3>Abrir Facebook</h3><button class="x" data-cerrar>✕</button></div>
      <div class="modal-b"><p>El navegador bloqueó la ventana. Abrila desde acá:</p>
      <a class="btn" href="${esc(inicio.url)}" target="impar-facebook">Abrir Facebook</a></div>`);
    $$('[data-cerrar]').forEach(b => b.onclick = cerrar);
  }
  esperar(inicio.state, { sucursales, alTerminar });
}

function esperar(state, ctx) {
  clearInterval(sondeo); try { canalAviso?.close(); } catch {}
  toast('Iniciá sesión en la ventana de Facebook y elegí la página de IMPAR.', 'ok', 'Facebook');
  let terminado = false, vueltas = 0;
  const revisar = async () => {
    if (terminado) return;
    if (++vueltas > 450) { clearInterval(sondeo); return; } // 15 minutos
    try {
      const e = await get('/meta-login/estado/' + state);
      if (e.estado === 'pendiente') return;
      terminado = true; clearInterval(sondeo); try { canalAviso?.close(); } catch {}
      if (e.estado === 'listo') elegir(state, e.paginas, ctx);
      else if (e.estado === 'error') toast(e.error || 'No se pudo conectar con Facebook.', 'bad', 'Facebook');
    } catch { /* se reintenta en la próxima vuelta */ }
  };
  sondeo = setInterval(revisar, 2000);
  try {
    canalAviso = new BroadcastChannel('impar-meta-login');
    canalAviso.onmessage = ev => { if (ev.data?.tipo === 'meta-login' && ev.data.state === state) revisar(); };
  } catch { /* el sondeo alcanza */ }
}

function elegir(state, paginas, { sucursales, alTerminar }) {
  const una = paginas.length === 1;
  modal(`<div class="modal-h"><h3>${ic('mensaje')} Elegí qué conectar</h3><button class="x" data-cerrar>✕</button></div>
    <div class="modal-b">
      <fieldset class="ml-paginas"><legend>Página de Facebook</legend>
        ${paginas.map((p, i) => `<label class="ml-pagina"><input type="radio" name="ml-pag" value="${esc(p.page_id)}" ${i === 0 ? 'checked' : ''}>
          <span><b>${esc(p.page_nombre)}</b><small>${p.ig_usuario ? 'Instagram @' + esc(p.ig_usuario) : 'Sin Instagram profesional vinculado'}</small></span></label>`).join('')}
      </fieldset>
      <fieldset class="ml-redes"><legend>Canales a crear</legend>
        <label><input type="checkbox" id="ml-fb" checked> Facebook Messenger</label>
        <label><input type="checkbox" id="ml-ig"> Instagram Direct <small id="ml-ig-nota"></small></label>
      </fieldset>
      <div class="field"><label for="ml-suc">Sucursal dueña de los canales</label><select id="ml-suc">
        <option value="">Sin sucursal (reparte a todos)</option>
        ${sucursales.map(s => `<option value="${esc(s.id)}" ${/central/i.test(s.nombre) ? 'selected' : ''}>${esc(s.nombre)}</option>`).join('')}</select></div>
      <p class="sub">Los canales arrancan con las respuestas automáticas apagadas. Si ya existía un canal para esta página, se renueva su acceso.</p>
      <div class="err" id="ml-err"></div></div>
    <div class="modal-f"><button class="btn ghost" data-cerrar>Cancelar</button><button class="btn" id="ml-ok">Conectar</button></div>`);
  $$('[data-cerrar]').forEach(b => b.onclick = cerrar);
  const actualizarIg = () => {
    const p = paginas.find(x => x.page_id === $('[name="ml-pag"]:checked').value);
    $('#ml-ig').disabled = !p.ig_id; $('#ml-ig').checked = !!p.ig_id;
    $('#ml-ig-nota').textContent = p.ig_id ? '@' + p.ig_usuario : '(esta página no tiene Instagram vinculado)';
  };
  $$('[name="ml-pag"]').forEach(r => r.onchange = actualizarIg);
  actualizarIg();
  if (una) $('#ml-ok').focus();
  $('#ml-ok').onclick = async () => {
    const btn = $('#ml-ok'); btn.disabled = true; btn.textContent = 'Conectando…';
    try {
      const r = await post('/meta-login/conectar', {
        state, pageId: $('[name="ml-pag"]:checked').value,
        messenger: $('#ml-fb').checked, instagram: $('#ml-ig').checked, sucursalId: $('#ml-suc').value || null
      });
      cerrar();
      toast(`${r.pagina.page_nombre}: ${r.canales.map(c => (c.tipo === 'instagram' ? 'Instagram' : 'Messenger') + (c.actualizado ? ' (acceso renovado)' : '')).join(' y ')} conectado.`, 'ok', 'Facebook');
      alTerminar?.();
    } catch (e) {
      $('#ml-err').textContent = e.data?.error || e.message;
      btn.disabled = false; btn.textContent = 'Conectar';
    }
  };
}
