/* ============ Ficha de negociación · adjuntos · botones · ubicaciones ============ */
import {
  $, $$, esc, S, get, post, patch, put, del, gs, fdate, fd, ago, toast, modal, cerrar,
  confirmar, fx, esAdmin, esMando, etapa, ORIGENES, vacio, vibrar, esMovil
} from './core.js';
import { mover, patchTarjeta, quitarTarjetas } from './negociaciones.js';
import { conectarAdjuntos, mediaHTML, activarVisor, subir, elegirArchivo, ICONOS } from './adjuntos.js';
import { conectarEmojis } from './emojis.js';
import { actualizarMensajes } from './chat-mensajes.js';

let actual = null, usuarios = [], rapidas = { equipo: [], personales: [] }, adj = null;

export async function fichaNeg(id) {
  modal(`<div class="modal-b" style="text-align:center;padding:48px"><span class="spin lg"></span>
    <div style="color:var(--muted);font-size:var(--fs-sm);margin-top:14px">Cargando conversación…</div></div>`, true);
  try {
    const [n, us, rp] = await Promise.all([
      get(`/negociaciones/${id}`),
      usuarios.length ? Promise.resolve(usuarios) : get('/admin/usuarios'),
      get('/admin/rapidas')
    ]);
    actual = n; usuarios = us; rapidas = rp;
    pintar();
  } catch (e) { cerrar(); toast(e.message, 'bad'); }
}

const misRapidas = () => {
  const suc = S.usuario.sucursal;
  const eq = (rapidas.equipo || []).filter(q => q.ambito === 'empresa' || (q.ambito === 'sucursal' && q.sucursal === suc));
  return [...(rapidas.personales || []).map(q => ({ ...q, ambito: 'personal' })), ...eq];
};

function pintar() {
  const n = actual;
  const cerrada = ['ganado', 'cerrado'].includes(n.etapa);
  const marc = n.marcadores || [];
  const chips = [];
  if (marc.includes('frecuente') && fx('marcadorFrecuente')) chips.push('<span class="tag t-frec">★ Frecuente</span>');
  if (marc.includes('regestionado') && fx('marcadorRegestion')) chips.push('<span class="tag t-re">↻ Re gestionado</span>');
  if (marc.includes('transferido') && fx('marcadorTransferido')) chips.push('<span class="tag t-tr">⇄ Transferido</span>');
  if (marc.includes('manual')) chips.push('<span class="tag t-man">✎ Carga manual</span>');
  const ubis = n.ubicaciones || [];

  modal(`<div class="modal-h"><h3>${esc(n.cliente)} · <span id="f-etapa" style="color:${etapa(n.etapa).color}">${esc(etapa(n.etapa).nombre)}</span></h3>
   ${esAdmin() && fx('eliminarNegociaciones') ? `<button class="btn danger sm" id="f-borrar">🗑</button>` : ''}
   <button class="x" data-cerrar>✕</button></div>
  <div class="modal-b">
   <details class="ficha-contexto" ${esMovil() ? '' : 'open'}><summary>Datos de la negociación</summary>
   <div class="row" style="margin-bottom:12px">
     ${fx('fechaCreacion') ? `<span class="pill" style="flex:none">📅 Creada ${fdate(n.creado)}</span>` : ''}
     <span class="pill" style="flex:none">🔄 ${ago(n.actualizado)} atrás</span>
     ${n.canal_nombre ? `<span class="pill" style="flex:none">📡 ${esc(n.canal_nombre)}</span>` : ''}
     ${n.etapa === 'ganado' ? `<span class="pill" style="flex:none;border-color:var(--ok)">💰 <b style="color:var(--ok)">${gs(n.monto_cierre)}</b></span>` : ''}
     <span class="pill" style="flex:none">🤖 Bot
       <label class="sw" style="margin-left:6px"><input type="checkbox" id="f-bot" ${n.bot_activo !== false ? 'checked' : ''}><i></i></label></span>
     <span style="flex:none">${chips.join('')}</span></div>

   ${ubis.length && fx('detectarUbicacion') ? `<div class="card-box fx-pop" style="border-color:#2b6a7a">
     <h3>📍 Direcciones detectadas (${ubis.length})</h3>
     ${ubis.slice(0, 4).map(u => `<div class="msg-ubi" style="display:flex;gap:10px;align-items:center;padding:9px 0;border-bottom:1px solid var(--line)">
       <span style="font-size:19px">${u.fuente === 'gps' ? '🛰' : u.fuente === 'link' ? '🔗' : '✍️'}</span>
       <div style="flex:1;min-width:0"><b style="font-size:var(--fs-sm);display:block">${esc(u.direccion || u.texto)}</b>
         <small style="color:var(--muted)">${u.fuente} · confianza ${u.confianza} · ${fdate(u.ts)}
           ${u.confirmada ? ' · <span style="color:var(--ok)">confirmada</span>' : ''}</small></div>
       <div style="flex:none;display:flex;gap:6px">
         ${u.lat != null ? `<a class="btn ghost sm" href="https://www.google.com/maps/search/?api=1&query=${u.lat},${u.lon}" target="_blank" rel="noopener">🗺 Ver</a>` : ''}
         ${!u.confirmada ? `<button class="btn ghost sm" data-confubi="${u.id}">✓ Confirmar</button>` : ''}</div></div>`).join('')}
     </div>` : ''}

   ${(n.transferencias || []).length && fx('marcadorTransferido') ? `<div class="card-box" style="border-color:#5b47a0">
     <h3>⇄ Historial de transferencias (${n.transferencias.length})</h3>
     <ul class="tl">${n.transferencias.map(t => `<li>${esc(t.de_nombre || 'Sin asignar')} → <b>${esc(t.a_nombre)}</b>${t.nota ? ' · ' + esc(t.nota) : ''}
       <small>${fdate(t.ts)} · por ${esc(t.por || '')}</small></li>`).join('')}</ul></div>` : ''}

   </details>
   <div class="tabs"><button class="tab active" data-tab="t-chat">Conversación</button>
     <button class="tab" data-tab="t-det">Detalle</button>
     <button class="tab" data-tab="t-his">Historial</button></div>

   <div id="t-chat">
     <div class="chat" id="chatbox"></div>

     ${cerrada ? `<div class="card-box chat-compose" style="margin:12px 0 0;border-color:var(--warn)">
       <b style="font-size:var(--fs-sm)">Negociación ${n.etapa === 'ganado' ? 'cerrada ganada' : 'cerrada'}</b>
       <div style="color:var(--muted);font-size:var(--fs-sm);margin:6px 0 10px">Al enviar un mensaje se genera una
         <b>nueva negociación en Contactado</b> con marcador «Re gestionado».</div>
       ${herramientasHTML('remsg')}
       <div id="adj-re" hidden></div>
       <div class="row chat-input-row" style="align-items:center;position:relative">
         ${fx('adjuntos') ? `<button class="btn-adj" id="f-adj-re" type="button" title="Adjuntar">📎</button>` : ''}
         <textarea id="remsg" rows="3" enterkeyhint="enter" aria-label="Mensaje al cliente" placeholder="Escribir mensaje al cliente…"></textarea>
         <button class="btn" style="flex:none" id="f-rege">Enviar y re gestionar</button></div></div>`
     : `<div class="chat-compose">${herramientasHTML('msg')}
        <div id="adj-barra" hidden></div>
        <div class="row chat-input-row" style="margin-top:8px;align-items:center;position:relative">
        ${fx('adjuntos') ? `<button class="btn-adj" id="f-adj" type="button" title="Adjuntar archivo (o pegá con Ctrl+V)">📎</button>` : ''}
        <textarea id="msg" rows="3" enterkeyhint="enter" aria-label="Mensaje al cliente" placeholder="Escribir mensaje, pegar o arrastrar un archivo…"></textarea>
        <button class="btn" style="flex:none" id="f-enviar">Enviar</button></div></div>`}
   </div>

   <div id="t-det" class="hidden">
    <div class="grid g2">
      <div class="card-box"><h3>Cliente</h3>
       <div><b>${esc(n.cliente)}</b> ${n.frecuente ? '<span class="tag t-frec">★ Frecuente</span>' : ''}</div>
       <div style="color:var(--muted);font-size:var(--fs-sm);margin-top:6px">📞 ${esc(n.tel || '—')}<br>
         ✉ ${esc(n.cliente_email || '—')}<br>
         ${n.cliente_direccion ? `📍 ${esc(n.cliente_direccion)}<br>` : ''}
         🏢 ${esc(n.sucursal || '—')} · ${esc(n.linea || '—')}</div>
       <button class="btn ghost sm" style="margin-top:10px" id="f-360">Ver ficha 360°</button></div>
      <div class="card-box"><h3>Negociación</h3>
       <div class="field"><label>Título</label><input id="n-tit" value="${esc(n.titulo || '')}"></div>
       <div class="field"><label>${n.etapa === 'ganado' ? 'Monto de cierre (Gs)' : 'Valor estimado (Gs)'}</label>
         <input id="n-val" type="number" inputmode="numeric" value="${n.etapa === 'ganado' ? (n.monto_cierre || 0) : (n.valor || 0)}"></div>
       <div class="field"><label>Origen</label><select id="n-ori">
         ${ORIGENES.map(o => `<option ${n.origen === o ? 'selected' : ''}>${o}</option>`).join('')}</select></div>
       <button class="btn sm" id="f-guardar">Guardar</button></div></div>
    <div class="grid g2">
      <div class="card-box"><h3>Responsable</h3>
       <div style="margin-bottom:8px;color:var(--muted);font-size:var(--fs-sm)">Actual:
         <b style="color:var(--txt)">${esc(n.agente_nombre || 'Sin asignar')}</b></div>
       <div class="field"><label>Transferir a</label><select id="n-ag"><option value="">— seleccionar —</option>
         ${usuarios.map(u => `<option value="${u.id}">${esc(u.nombre)} (${u.rol} · ${esc(u.sucursal || '')})</option>`).join('')}</select></div>
       <div class="field"><label>Nota de transferencia</label><input id="n-nota" placeholder="Motivo (opcional)"></div>
       <button class="btn sm" id="f-transferir">⇄ Transferir</button></div>
      <div class="card-box"><h3>Mover de etapa</h3>
       <div style="display:flex;flex-wrap:wrap;gap:7px">
        ${(S.empresa.etapas || []).filter(e => e.id !== n.etapa).map(e =>
          `<button class="btn ghost sm" data-mover="${e.id}">${esc(e.nombre)}</button>`).join('')}</div>
       ${n.motivo ? `<div style="margin-top:10px;color:var(--muted);font-size:var(--fs-sm)">Motivo: <b style="color:var(--txt)">${esc(n.motivo)}</b></div>` : ''}</div></div>
   </div>

   <div id="t-his" class="hidden"><ul class="tl">${(n.historial || []).map(h =>
     `<li>${esc(h.txt)}<small>${fdate(h.ts)} · ${esc(h.por)}</small></li>`).join('')}</ul></div>
  </div>`, true);

  $('.modal').classList.add('conversation-modal');
  $('.mask')?.classList.add('conversation-mask');
  $('.modal').dataset.negociacionId = n.id;
  const cb = $('#chatbox'); if (cb) { cb.innerHTML = ''; actualizarMensajes(cb, n.mensajes || [], mensajeHTML, true); activarVisor(cb); }
  conectar(n);
}

function mensajeHTML(m) {
       const media = mediaHTML(m);
       const u = m.ubicacion;
       const mapaUbi = u?.lat != null
         ? `<a class="ubi" href="https://www.google.com/maps/search/?api=1&query=${u.lat},${u.lon}" target="_blank" rel="noopener">
              <span class="pin">📍</span><div style="min-width:0"><b style="font-size:var(--fs-sm);display:block">${esc(u.nombre || 'Ubicación compartida')}</b>
              <small style="color:var(--muted)">${esc(u.direccion || `${u.lat}, ${u.lon}`)}</small></div></a>` : '';
       return `<div class="msg ${m.dir} ${media ? 'media' : ''} ${m.estado === 'pendiente' ? 'pendiente' : ''} ${m.estado === 'error' ? 'error' : ''}">
          ${media}${m.txt ? `<div class="${media ? 'pie' : ''}">${esc(m.txt)}</div>` : ''}${mapaUbi}
          <small>${m.bot ? '🤖 Bot · ' : ''}${fdate(m.ts)}
          ${m.estado === 'pendiente' ? ' · enviando…' : m.estado === 'error' ? ' · ⚠ no enviado' : ''}</small></div>`;
}

export async function refrescarFicha(id, seguir = false) {
  const caja = $('#chatbox'), ficha = $('.conversation-modal');
  if (!caja || ficha?.dataset.negociacionId !== id) return;
  const revision = caja._revision = (caja._revision || 0) + 1;
  const n = await get(`/negociaciones/${id}`);
  if ($('#chatbox') !== caja || $('.conversation-modal') !== ficha || caja._revision !== revision) return;
  actual = n;
  actualizarMensajes(caja, n.mensajes || [], mensajeHTML, seguir);
  activarVisor(caja);
  const titulo = $('#f-etapa');
  if (titulo) { titulo.textContent = etapa(n.etapa).nombre; titulo.style.color = etapa(n.etapa).color; }
  if ($('#f-bot')) $('#f-bot').checked = n.bot_activo !== false;
  const historial = $('#t-his .tl');
  if (historial) historial.innerHTML = (n.historial || []).map(h => `<li>${esc(h.txt)}<small>${fdate(h.ts)} · ${esc(h.por)}</small></li>`).join('');
}

function herramientasHTML(campo) {
  const html = botonesHTML(campo) + rapidasHTML(campo);
  return html ? `<details class="chat-tools" ${esMovil() ? '' : 'open'}><summary>Respuestas y acciones</summary>${html}</details>` : '';
}

/* ---------- Botones personalizados ---------- */
function botonesHTML(campo) {
  if (!fx('botonesPersonalizados')) return '';
  const bs = S.empresa.reglas?.botones || [];
  if (!bs.length) return '';
  return `<div class="acciones">${bs.map((b, i) =>
    `<button class="bpers" data-bpers="${i}" data-campo="${campo}" style="--bc:${esc(b.color || 'var(--brand)')}">
      <span class="em">${esc(b.icono || '⚡')}</span><span>${esc(b.texto)}</span></button>`).join('')}
    ${esAdmin() ? `<button class="bpers" data-config-btn style="--bc:var(--muted)"><span class="em">⚙</span><span>Configurar</span></button>` : ''}</div>`;
}

function rapidasHTML(campo) {
  if (!fx('respuestasRapidas')) return '';
  const qs = misRapidas();
  return `<div style="margin-top:10px"><div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
    <b style="font-size:var(--fs-xs);color:var(--muted);letter-spacing:.4px">RESPUESTAS RÁPIDAS</b>
    <button class="btn ghost sm" data-gestionar>⚙ Gestionar</button></div>
   <div class="qr-chips">${qs.map(q => {
     const conImg = q.media_url && (q.media_tipo === 'imagen' || q.archivo_tipo === 'imagen');
     const etiqueta = q.txt || q.media_nombre || q.archivo_nombre || 'Archivo';
     return `<button class="qchip ${conImg ? 'con-img' : ''}" data-rapida="${esc(q.txt || '')}"
       data-arch="${esc(q.archivo_id || '')}" data-murl="${esc(q.media_url || '')}"
       data-mtipo="${esc(q.archivo_tipo || q.media_tipo || '')}" data-mnombre="${esc(q.archivo_nombre || q.media_nombre || '')}"
       data-mbytes="${q.archivo_bytes || 0}" data-campo="${campo}" title="${esc(etiqueta)}">
       ${conImg ? `<img src="${esc(q.media_url)}" alt="">` : (q.media_url ? (ICONOS[q.archivo_tipo || q.media_tipo] || '📎') + ' ' : '')}
       ${esc(etiqueta.slice(0, 38))}${etiqueta.length > 38 ? '…' : ''}</button>`;
   }).join('') || '<span style="color:var(--muted);font-size:var(--fs-xs)">Sin plantillas. Creá la primera desde «Gestionar».</span>'}</div></div>`;
}

function conectar(n) {
  conectarEmojis('#msg');
  conectarEmojis('#remsg');
  $$('[data-cerrar]').forEach(b => b.onclick = cerrar);
  $$('.tab').forEach(t => t.onclick = () => {
    $$('.tab').forEach(x => x.classList.remove('active')); t.classList.add('active');
    ['t-chat', 't-det', 't-his'].forEach(x => $('#' + x).classList.add('hidden'));
    const p = $('#' + t.dataset.tab); p.classList.remove('hidden'); p.classList.add('fx-vista');
  });

  /* respuestas rápidas */
  $$('[data-rapida]').forEach(b => b.onclick = () => {
    const el = $('#' + b.dataset.campo); if (!el) return;
    if (b.dataset.rapida) el.value = (el.value ? el.value.trim() + ' ' : '') + b.dataset.rapida;
    if (b.dataset.arch && adj) adj.poner({ id: b.dataset.arch, url: b.dataset.murl, tipo: b.dataset.mtipo,
      nombre: b.dataset.mnombre, bytes: Number(b.dataset.mbytes) || 0 });
    el.focus(); vibrar(10);
  });
  $$('[data-gestionar]').forEach(b => b.onclick = modalRapidas);

  /* botones personalizados */
  $$('[data-bpers]').forEach(b => b.onclick = () => ejecutarBoton(Number(b.dataset.bpers), b.dataset.campo, b, n));
  const cfg = $('[data-config-btn]');
  if (cfg) cfg.onclick = () => import('./admin.js').then(m => { cerrar(); m.irABotones(); });

  $$('[data-mover]').forEach(b => b.onclick = () => { cerrar(); mover(n.id, b.dataset.mover); });
  $$('[data-confubi]').forEach(b => b.onclick = async () => {
    await post(`/negociaciones/${n.id}/ubicaciones/confirmar`, { ubicacionId: Number(b.dataset.confubi) });
    toast('Dirección confirmada en la ficha del cliente', 'ok', '📍 Ubicación');
    fichaNeg(n.id);
  });

  $('#f-bot').onchange = async e => {
    await patch(`/negociaciones/${n.id}/bot`, { activo: e.target.checked });
    toast(`Bot ${e.target.checked ? 'reactivado' : 'desactivado'} en esta conversación`, e.target.checked ? 'ok' : 'warn', 'Bot');
    patchTarjeta(n.id);
  };
  if ($('#f-borrar')) $('#f-borrar').onclick = async () => {
    if (!await confirmar('Eliminar negociación',
      `Se eliminará la negociación de <b>${esc(n.cliente)}</b>. El contacto y su ficha 360° se conservan.`, 'Eliminar')) return;
    await post('/negociaciones/eliminar', { ids: [n.id], motivo: 'Eliminada desde la ficha' });
    cerrar(); quitarTarjetas([n.id]); toast('Negociación eliminada', 'warn');
  };
  $('#f-360').onclick = async () => {
    const { ficha360 } = await import('./contactos.js');
    cerrar(); ficha360(n.contacto_id);
  };
  $('#f-guardar').onclick = async () => {
    try {
      await patch(`/negociaciones/${n.id}`, { titulo: $('#n-tit').value,
        valor: Number($('#n-val').value) || 0, origen: $('#n-ori').value });
      toast('Negociación actualizada', 'ok'); patchTarjeta(n.id); fichaNeg(n.id);
    } catch (e) { toast(e.message, 'bad'); }
  };
  $('#f-transferir').onclick = async () => {
    const destinoId = $('#n-ag').value;
    if (!destinoId) return toast('Elegí un responsable', 'warn');
    await post(`/negociaciones/${n.id}/transferir`, { destinoId, nota: $('#n-nota').value.trim() });
    const u = usuarios.find(x => x.id === destinoId);
    cerrar(); patchTarjeta(n.id); toast(`Transferida a ${u.nombre}`, 'ok', 'Transferencia');
  };

  /* envío */
  adj = null;
  if ($('#f-enviar')) {
    if (fx('adjuntos')) adj = conectarAdjuntos({ inputSel: '#msg', barraSel: '#adj-barra', botonSel: '#f-adj', zonaSel: '#t-chat' });
    let enviando = false;
    const input = $('#msg'), boton = $('#f-enviar'), adjuntos = adj;
    boton.onpointerdown = e => { if (document.activeElement === input) e.preventDefault(); };
    const enviar = async () => {
      if (enviando) return;
      const borrador = input.value, txt = borrador.trim();
      const archivoId = adjuntos?.archivo?.id || null;
      if (!txt && !archivoId) return;
      enviando = true; input.value = ''; boton.disabled = true;
      try {
        await post(`/negociaciones/${n.id}/mensajes`, { texto: txt, archivoId });
      } catch (e) {
        input.value = input.value ? borrador + '\n' + input.value : borrador;
        toast(e.message, 'bad'); return;
      } finally { enviando = false; boton.disabled = false; }
      if (adjuntos?.archivo?.id === archivoId) adjuntos?.limpiar();
      vibrar(12); patchTarjeta(n.id);
      try { await refrescarFicha(n.id, true); }
      catch { toast('Mensaje guardado. La conversación se actualizará al recuperar la conexión.', 'warn'); }
    };
    $('#f-enviar').onclick = enviar;
  }
  if ($('#f-rege')) {
    if (fx('adjuntos')) adj = conectarAdjuntos({ inputSel: '#remsg', barraSel: '#adj-re', botonSel: '#f-adj-re', zonaSel: '#t-chat' });
    $('#f-rege').onclick = async () => {
      const txt = $('#remsg').value.trim();
      const archivoId = adj?.archivo?.id || null;
      if (!txt && !archivoId) return toast('Escribí un mensaje o adjuntá un archivo', 'warn');
      const boton = $('#f-rege'); if (boton.disabled) return; boton.disabled = true;
      try {
        const r = await post(`/negociaciones/${n.id}/regestionar`, { texto: txt, archivoId });
        toast('Nueva negociación en Contactado', 'ok', 'Re gestionado');
        patchTarjeta(r.id, { nueva: true });
        const nueva = await get(`/negociaciones/${r.id}`);
        if ($('.conversation-modal')?.dataset.negociacionId === n.id) { actual = nueva; pintar(); }
      } catch (e) {
        if (e.data?.negociacionId) { toast('Ya existe una negociación abierta', 'warn'); fichaNeg(e.data.negociacionId); }
        else toast(e.message, 'bad');
      } finally { boton.disabled = false; }
    };
  }
}

/* ---------- Acciones de los botones personalizados ---------- */
async function ejecutarBoton(i, campo, btn, n) {
  const b = (S.empresa.reglas?.botones || [])[i];
  if (!b) return;
  const el = $('#' + campo);
  vibrar(14);
  btn.classList.add('cargando');
  try {
    if (b.accion === 'mensaje') {
      if (el) { el.value = (el.value ? el.value.trim() + ' ' : '') + b.valor; el.focus(); }
    } else if (b.accion === 'catalogo') {
      const link = S.empresa.stock?.link;
      if (!link) return toast('El administrador todavía no cargó el link del catálogo.', 'warn', 'Catálogo');
      if (el) { el.value = (el.value ? el.value.trim() + ' ' : '') + `Te paso nuestro catálogo: ${link}`; el.focus(); }
    } else if (b.accion === 'etapa') {
      cerrar(); return mover(n.id, b.valor);
    } else if (b.accion === 'ubicacion') {
      const texto = el?.value?.trim() || (n.mensajes || []).filter(m => m.dir === 'in').slice(-1)[0]?.txt || '';
      if (!texto) return toast('No hay texto para analizar.', 'warn', 'Ubicación');
      const r = await post(`/negociaciones/${n.id}/detectar-ubicacion`, { texto });
      if (!r.encontrada) return toast('No se detectó ninguna dirección en el texto.', 'warn', '📍 Ubicación');
      toast(`Dirección detectada: ${r.ubicacion.direccion || r.ubicacion.texto}`, 'ok', '📍 Ubicación');
      return fichaNeg(n.id);
    } else if (b.accion === 'adjunto') {
      const f = await elegirArchivo('todo');
      if (f && adj) await adj.cargar(f);
    }
  } catch (e) { toast(e.message, 'bad'); }
  finally { btn.classList.remove('cargando'); }
}

/* ---------- Respuestas rápidas ---------- */
export async function modalRapidas() {
  rapidas = await get('/admin/rapidas');
  const sucs = S.sucursales.map(s => s.nombre);
  const mini = q => {
    const url = q.media_url, tipo = q.archivo_tipo || q.media_tipo;
    if (!url) return '<div class="sin-img">—</div>';
    return tipo === 'imagen'
      ? `<img class="miniatura" src="${esc(url)}" alt="" data-ver="${esc(url)}" data-nombre="${esc(q.archivo_nombre || q.media_nombre || '')}">`
      : `<div class="sin-img">${ICONOS[tipo] || '📎'}</div>`;
  };

  modal(`<div class="modal-h"><h3>⚡ Respuestas rápidas</h3><button class="x" data-cerrar>✕</button></div>
  <div class="modal-b">
   <div class="card-box"><h3>Mis plantillas personales (${rapidas.personales.length})</h3>
    <p class="sub" style="margin-top:-6px">Solo vos las ves. Podés incluir una imagen o archivo.</p>
    ${rapidas.personales.map((q, i) => `<div class="rapida-fila">
      ${q.media_url ? (q.media_tipo === 'imagen'
        ? `<img class="miniatura" src="${esc(q.media_url)}" alt="" data-ver="${esc(q.media_url)}" data-nombre="${esc(q.media_nombre || '')}">`
        : `<div class="sin-img">${ICONOS[q.media_tipo] || '📎'}</div>`) : '<div class="sin-img">—</div>'}
      <div style="flex:1;min-width:0">
        <input value="${esc(q.txt || '')}" data-mia="${i}" placeholder="Texto (opcional si hay imagen)"
          style="width:100%;background:var(--surface2);border:1px solid var(--line);border-radius:8px;padding:8px">
        ${q.media_nombre ? `<small style="color:var(--muted);font-size:var(--fs-xs)">${esc(q.media_nombre)}</small>` : ''}</div>
      <div style="flex:none;display:flex;gap:5px">
        <button class="btn ghost sm" data-imgmia="${i}" title="Adjuntar">📎</button>
        ${q.media_url ? `<button class="btn ghost sm" data-quitmia="${i}" title="Quitar adjunto">🚫</button>` : ''}
        <button class="btn danger sm" data-delmia="${i}">✕</button></div></div>`).join('')
      || '<div class="empty">Sin plantillas propias</div>'}
    <div id="rp-nueva-adj" hidden></div>
    <div class="row" style="margin-top:9px;align-items:center;position:relative">
      <button class="btn-adj" id="qr-adjmia" type="button" title="Adjuntar">📎</button>
      <input id="qr-mia" placeholder="Nueva respuesta rápida personal…">
      <button class="btn sm" style="flex:none" id="qr-addmia">Agregar</button></div></div>

   ${esMando() ? `<div class="card-box"><h3>Plantillas del equipo (${rapidas.equipo.length})</h3>
    <p class="sub" style="margin-top:-6px">Como ${S.usuario.rol} podés publicarlas para toda la empresa o para una sucursal.</p>
    ${rapidas.equipo.map(q => `<div class="rapida-fila">${mini(q)}
      <div style="flex:1;min-width:0">
        <input value="${esc(q.txt || '')}" data-eq="${q.id}" placeholder="Texto (opcional si hay imagen)"
          style="width:100%;background:var(--surface2);border:1px solid var(--line);border-radius:8px;padding:8px">
        <div style="display:flex;gap:6px;margin-top:5px;align-items:center">
          <select data-amb="${q.id}" style="flex:1;background:var(--surface2);border:1px solid var(--line);border-radius:8px;padding:6px;font-size:var(--fs-xs)">
            <option value="empresa" ${q.ambito === 'empresa' ? 'selected' : ''}>Toda la empresa</option>
            ${sucs.map(x => `<option value="suc:${esc(x)}" ${q.ambito === 'sucursal' && q.sucursal === x ? 'selected' : ''}>Sucursal ${esc(x)}</option>`).join('')}</select>
          ${q.archivo_nombre || q.media_nombre ? `<small style="color:var(--muted);font-size:var(--fs-xs)">${esc(q.archivo_nombre || q.media_nombre)}</small>` : ''}</div></div>
      <div style="flex:none;display:flex;gap:5px">
        <button class="btn ghost sm" data-imgeq="${q.id}" title="Adjuntar">📎</button>
        ${q.media_url ? `<button class="btn ghost sm" data-quiteq="${q.id}" title="Quitar adjunto">🚫</button>` : ''}
        <button class="btn danger sm" data-deleq="${q.id}">✕</button></div></div>`).join('')
      || '<div class="empty">Sin plantillas del equipo</div>'}
    <div id="rp-eq-adj" hidden></div>
    <div class="row" style="margin-top:9px;align-items:center;position:relative">
      <button class="btn-adj" id="qr-adjemp" type="button" title="Adjuntar">📎</button>
      <input id="qr-emp" placeholder="Nueva plantilla del equipo…">
      <select id="qr-amb" style="max-width:190px;background:var(--surface2);border:1px solid var(--line);border-radius:9px;padding:10px">
        <option value="empresa">Toda la empresa</option>
        ${sucs.map(x => `<option value="suc:${esc(x)}" ${S.usuario.sucursal === x ? 'selected' : ''}>Sucursal ${esc(x)}</option>`).join('')}</select>
      <button class="btn sm" style="flex:none" id="qr-addemp">Publicar</button></div></div>` : ''}
  </div><div class="modal-f"><button class="btn" id="qr-listo">Listo</button></div>`, true);

  activarVisor($('.modal'));
  const volver = () => { cerrar(); if (actual) fichaNeg(actual.id); };
  $$('[data-cerrar]').forEach(b => b.onclick = volver);
  $('#qr-listo').onclick = volver;

  const adjMia = conectarAdjuntos({ inputSel: '#qr-mia', barraSel: '#rp-nueva-adj', botonSel: '#qr-adjmia' });
  const adjEmp = $('#qr-emp') ? conectarAdjuntos({ inputSel: '#qr-emp', barraSel: '#rp-eq-adj', botonSel: '#qr-adjemp' }) : null;
  const guardarMias = () => put('/admin/rapidas-personales', { rapidas: rapidas.personales });

  $$('[data-mia]').forEach(el => el.onchange = () => { rapidas.personales[el.dataset.mia].txt = el.value; guardarMias(); });
  $$('[data-delmia]').forEach(b => b.onclick = async () => {
    rapidas.personales.splice(Number(b.dataset.delmia), 1); await guardarMias(); modalRapidas();
  });
  $$('[data-quitmia]').forEach(b => b.onclick = async () => {
    const q = rapidas.personales[Number(b.dataset.quitmia)];
    delete q.media_url; delete q.media_tipo; delete q.media_nombre; delete q.archivo_id;
    await guardarMias(); modalRapidas();
  });
  $$('[data-imgmia]').forEach(b => b.onclick = () => pedirArchivo(async a => {
    Object.assign(rapidas.personales[Number(b.dataset.imgmia)],
      { archivo_id: a.id, media_url: a.url, media_tipo: a.tipo, media_nombre: a.nombre });
    await guardarMias(); toast('Adjunto agregado a la plantilla', 'ok'); modalRapidas();
  }));
  $('#qr-addmia').onclick = async () => {
    const t = $('#qr-mia').value.trim(), a = adjMia.archivo;
    if (!t && !a) return toast('Escribí un texto o adjuntá una imagen', 'warn');
    rapidas.personales.push({ id: 'p' + Date.now(), txt: t, archivo_id: a?.id || null,
      media_url: a?.url || null, media_tipo: a?.tipo || null, media_nombre: a?.nombre || null });
    await guardarMias(); toast('Plantilla personal guardada', 'ok'); modalRapidas();
  };

  $$('[data-eq]').forEach(el => el.onchange = () => patch(`/admin/rapidas/${el.dataset.eq}`, { txt: el.value }));
  $$('[data-amb]').forEach(el => el.onchange = () => {
    const v = el.value;
    patch(`/admin/rapidas/${el.dataset.amb}`,
      v === 'empresa' ? { ambito: 'empresa' } : { ambito: 'sucursal', sucursal: v.slice(4) });
  });
  $$('[data-deleq]').forEach(b => b.onclick = async () => { await del(`/admin/rapidas/${b.dataset.deleq}`); modalRapidas(); });
  $$('[data-quiteq]').forEach(b => b.onclick = async () => {
    await patch(`/admin/rapidas/${b.dataset.quiteq}`, { quitarArchivo: true });
    toast('Adjunto quitado', 'ok'); modalRapidas();
  });
  $$('[data-imgeq]').forEach(b => b.onclick = () => pedirArchivo(async a => {
    await patch(`/admin/rapidas/${b.dataset.imgeq}`, { archivoId: a.id });
    toast('Adjunto agregado a la plantilla', 'ok'); modalRapidas();
  }));
  if ($('#qr-addemp')) $('#qr-addemp').onclick = async () => {
    const t = $('#qr-emp').value.trim(), a = adjEmp?.archivo;
    if (!t && !a) return toast('Escribí un texto o adjuntá una imagen', 'warn');
    const v = $('#qr-amb').value;
    const base = v === 'empresa' ? { ambito: 'empresa' } : { ambito: 'sucursal', sucursal: v.slice(4) };
    await post('/admin/rapidas', { ...base, txt: t, archivoId: a?.id || null });
    toast('Plantilla publicada para el equipo', 'ok'); modalRapidas();
  };
}

async function pedirArchivo(cb) {
  const f = await elegirArchivo('todo');
  if (!f) return;
  try { cb(await subir(f)); } catch (e) { toast(e.message, 'bad', 'Adjunto'); }
}
