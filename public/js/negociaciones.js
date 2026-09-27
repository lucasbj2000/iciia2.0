/* ============ Tablero de negociaciones ============ */
import {
  $, $$, esc, S, get, post, patch, gs, fd, ago, toast, modal, cerrar, confirmar,
  fx, esAdmin, etapa, etapaActiva, ORIGENES, vacio, skeleton, confeti, vibrar,
  destacar, animarContador, esMovil
} from './core.js';
import { fichaNeg } from './ficha.js';
import { conectarAdjuntos } from './adjuntos.js';

export const F = { q: '', origen: '', agente: '', marcador: '' };
export let SEL = new Set(), MODO_SEL = false;
let usuarios = [], canales = [];
const bloqueadas = new Set();

export async function vistaNegociaciones() {
  $('#view').innerHTML = `<div class="section">${skeleton(4)}</div>`;
  const [negs, us, cs] = await Promise.all([
    get('/negociaciones'), get('/admin/usuarios'), get('/canales').catch(() => [])
  ]);
  S.negociaciones = negs; usuarios = us; canales = cs;
  pintarShell();
}

function pintarShell() {
  const puedeBorrar = esAdmin() && fx('eliminarNegociaciones');
  const etapas = S.empresa.etapas || [];
  if (!S.etapaMovil || !etapas.some(e => e.id === S.etapaMovil)) S.etapaMovil = etapas[0]?.id;

  $('#view').innerHTML = `
  <div style="padding:14px 18px 0;display:flex;gap:9px;flex-wrap:wrap;align-items:center">
    <input id="f-q" placeholder="Buscar cliente, teléfono o título…" value="${esc(F.q)}"
      style="flex:2;min-width:180px;padding:10px 13px;background:var(--surface2);border:1px solid var(--line);border-radius:10px">
    <select id="f-origen" style="flex:1;min-width:130px;padding:10px;background:var(--surface2);border:1px solid var(--line);border-radius:10px">
      <option value="">Todos los orígenes</option>
      ${ORIGENES.map(o => `<option ${F.origen === o ? 'selected' : ''}>${o}</option>`).join('')}</select>
    <select id="f-marcador" style="flex:1;min-width:140px;padding:10px;background:var(--surface2);border:1px solid var(--line);border-radius:10px">
      <option value="">Todos los marcadores</option>
      ${[['frecuente', '★ Frecuente'], ['regestionado', '↻ Re gestionado'], ['transferido', '⇄ Transferido'], ['manual', '✎ Carga manual']]
        .map(([k, t]) => `<option value="${k}" ${F.marcador === k ? 'selected' : ''}>${t}</option>`).join('')}</select>
    ${S.usuario.rol !== 'agente' ? `<select id="f-agente" style="flex:1;min-width:140px;padding:10px;background:var(--surface2);border:1px solid var(--line);border-radius:10px">
      <option value="">Todos los agentes</option>
      ${usuarios.filter(u => u.rol === 'agente').map(u => `<option value="${u.id}" ${F.agente === u.id ? 'selected' : ''}>${esc(u.nombre)}</option>`).join('')}</select>` : ''}
    ${esAdmin() && fx('cargaManual') ? `<button class="btn sm" id="b-manual">✎ Carga manual</button>` : ''}
    ${puedeBorrar ? `<button class="btn ${MODO_SEL ? 'danger' : 'ghost'} sm" id="b-sel">${MODO_SEL ? '✕ Salir de selección' : '☑ Seleccionar'}</button>` : ''}
  </div>
  ${MODO_SEL ? `<div style="padding:10px 18px 0"><div class="card-box fx-pop" style="margin:0;border-color:var(--bad);display:flex;gap:10px;align-items:center;flex-wrap:wrap">
     <b style="flex:1;font-size:var(--fs-sm)">Seleccionadas: <span id="sel-n">${SEL.size}</span></b>
     <button class="btn ghost sm" id="b-seltodo">Seleccionar todo lo visible</button>
     <button class="btn ghost sm" id="b-sellimpiar">Limpiar</button>
     <button class="btn danger sm" id="b-selborrar">🗑 Eliminar seleccionadas</button>
     <button class="btn danger sm" id="b-masivo">⚠ Eliminación masiva</button></div></div>` : ''}
  <div class="etapa-tabs">${etapas.map(e =>
    `<button class="etapa-tab ${S.etapaMovil === e.id ? 'active' : ''}" data-etapa="${e.id}">
      ${esc(e.nombre)} <span style="opacity:.7" data-cnt="${e.id}">0</span></button>`).join('')}</div>
  <div class="kanban" id="kanban"></div>`;

  let tq;
  $('#f-q').oninput = e => { clearTimeout(tq); F.q = e.target.value; tq = setTimeout(pintarColumnas, 200); };
  $('#f-origen').onchange = e => { F.origen = e.target.value; pintarColumnas(); };
  $('#f-marcador').onchange = e => { F.marcador = e.target.value; pintarColumnas(); };
  if ($('#f-agente')) $('#f-agente').onchange = e => { F.agente = e.target.value; pintarColumnas(); };
  if ($('#b-manual')) $('#b-manual').onclick = () => modalCargaManual();
  if ($('#b-sel')) $('#b-sel').onclick = () => { MODO_SEL = !MODO_SEL; SEL.clear(); pintarShell(); };
  if ($('#b-seltodo')) $('#b-seltodo').onclick = () => { filtradas().forEach(n => SEL.add(n.id)); pintarColumnas(); };
  if ($('#b-sellimpiar')) $('#b-sellimpiar').onclick = () => { SEL.clear(); pintarColumnas(); };
  if ($('#b-selborrar')) $('#b-selborrar').onclick = borrarSeleccion;
  if ($('#b-masivo')) $('#b-masivo').onclick = modalMasivo;
  $$('.etapa-tab').forEach(b => b.onclick = () => { S.etapaMovil = b.dataset.etapa; vibrar(10); pintarShell(); });
  pintarColumnas();
}

function filtradas() {
  const q = F.q.toLowerCase();
  return S.negociaciones.filter(n => {
    if (F.origen && n.origen !== F.origen) return false;
    if (F.agente && n.agente_id !== F.agente) return false;
    if (F.marcador && !(n.marcadores || []).includes(F.marcador)) return false;
    if (q && !`${n.cliente || ''} ${n.tel || ''} ${n.titulo || ''}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

function pintarColumnas() {
  const ns = filtradas(), k = $('#kanban');
  if (!k) return;
  k.innerHTML = (S.empresa.etapas || []).map((e, i) => {
    const lista = ns.filter(n => n.etapa === e.id);
    lista.sort(e.id === 'espera'
      ? (a, b) => new Date(a.entrada_etapa) - new Date(b.entrada_etapa)
      : (a, b) => new Date(b.actualizado) - new Date(a.actualizado));
    return `<div class="col ${S.etapaMovil === e.id ? 'movil-visible' : ''}" data-col="${e.id}" style="animation-delay:${i * .05}s">
      <div class="col-h"><span class="dot" style="background:${e.color}"></span><b>${esc(e.nombre)}</b>
        ${e.activa ? '<span class="tag t-fecha" title="Etapa activa: sin duplicados">activa</span>' : ''}
        <span class="count">${lista.length}</span></div>
      <div class="col-b" data-body="${e.id}">
        ${lista.map(n => tarjeta(n)).join('') || vacio('◇', 'Sin negociaciones',
          e.id === 'nuevo' ? 'Los contactos entrantes caen acá' : '')}
      </div></div>`;
  }).join('');
  (S.empresa.etapas || []).forEach(e => {
    const c = $(`[data-cnt="${e.id}"]`);
    if (c) c.textContent = ns.filter(n => n.etapa === e.id).length;
  });
  conectarDrag();
  const sn = $('#sel-n'); if (sn) sn.textContent = SEL.size;
}

/* ---------- Patch por ítem ---------- */
export function bloquear(id, ms = 4000) {
  bloqueadas.add(id);
  setTimeout(() => bloqueadas.delete(id), ms);
}

export async function patchTarjeta(id, opts = {}) {
  if (bloqueadas.has(id)) return;
  try {
    const n = await get(`/negociaciones/${id}`);
    const i = S.negociaciones.findIndex(x => x.id === id);
    if (i >= 0) S.negociaciones[i] = { ...S.negociaciones[i], ...n };
    else S.negociaciones.push(n);
    if (!$('#kanban')) return;

    const vieja = $(`[data-id="${id}"]`);
    const destino = $(`[data-body="${n.etapa}"]`);
    if (!destino) { if (vieja) vieja.remove(); actualizarContadores(); return; }

    const tmp = document.createElement('div');
    tmp.innerHTML = tarjeta(n);
    const nueva = tmp.firstElementChild;

    if (vieja && vieja.closest('.col-b') === destino) {
      vieja.replaceWith(nueva);
    } else {
      if (vieja) vieja.remove();
      const vac = destino.querySelector('.empty'); if (vac) vac.remove();
      if (n.etapa === 'espera') destino.appendChild(nueva); else destino.prepend(nueva);
      if (opts.nueva) { nueva.classList.add('nueva'); vibrar(22); }
    }
    conectarTarjeta(nueva);
    if (opts.destacar) destacar(nueva);
    actualizarContadores();
  } catch (e) { /* pudo haberse borrado */ }
}

export function quitarTarjetas(ids) {
  ids.forEach(id => {
    const el = $(`[data-id="${id}"]`); if (el) el.remove();
    S.negociaciones = S.negociaciones.filter(n => n.id !== id);
  });
  actualizarContadores();
}

function actualizarContadores() {
  (S.empresa.etapas || []).forEach(e => {
    const body = $(`[data-body="${e.id}"]`); if (!body) return;
    const n = body.querySelectorAll('.card').length;
    const c = body.closest('.col')?.querySelector('.count');
    if (c && c.textContent !== String(n)) { c.textContent = n; animarContador(c); }
    const t = $(`[data-cnt="${e.id}"]`); if (t) t.textContent = n;
    if (!n && !body.querySelector('.empty')) body.innerHTML = vacio('◇', 'Sin negociaciones', '');
  });
}

/* ---------- Tarjeta ---------- */
function tarjeta(n) {
  const cls = { whatsapp: 'wa', facebook: 'fb', instagram: 'ig', telefonia: 'tel' }[n.origen] || 'otro';
  const marc = n.marcadores || [];
  const chips = [];
  if (marc.includes('frecuente') && fx('marcadorFrecuente')) chips.push('<span class="tag t-frec">★ Frecuente</span>');
  if (marc.includes('regestionado') && fx('marcadorRegestion')) chips.push('<span class="tag t-re">↻ Re gestionado</span>');
  if (marc.includes('transferido') && fx('marcadorTransferido')) chips.push('<span class="tag t-tr">⇄ Transferido</span>');
  if (marc.includes('manual')) chips.push('<span class="tag t-man">✎ Manual</span>');
  if (Number(n.n_ubicaciones) > 0) chips.push('<span class="tag t-ubi">📍 Dirección</span>');
  if (n.bot_activo === false) chips.push('<span class="tag t-bot">🤖 off</span>');
  if (fx('fechaCreacion')) chips.push(`<span class="tag t-fecha">📅 ${fd(n.creado)}</span>`);

  const visibles = chips.slice(0, 2), ocultos = chips.slice(2);
  const monto = n.etapa === 'ganado' && n.monto_cierre
    ? `<b style="color:var(--ok)">${gs(n.monto_cierre)}</b>`
    : (n.valor ? gs(n.valor) : '');

  let sla = '';
  if (n.etapa === 'contactado' || n.etapa === 'espera') {
    const horas = (Date.now() - new Date(n.entrada_etapa)) / 3600000;
    const limite = S.empresa.reglas?.slaHoras || 24;
    const pct = Math.min(100, horas / limite * 100);
    const nivel = pct >= 90 ? 'r' : pct >= 55 ? 'a' : 'v';
    const color = nivel === 'r' ? 'var(--bad)' : nivel === 'a' ? 'var(--warn)' : 'var(--ok)';
    sla = `<div class="sla ${nivel}"><i style="width:${pct}%"></i></div>
      <div class="sla-txt" style="color:${color}">⏱ ${n.etapa === 'espera' ? 'Esperando' : 'En seguimiento'} hace ${ago(n.entrada_etapa)}</div>`;
  }

  return `<div class="card ${SEL.has(n.id) ? 'sel' : ''}" data-id="${n.id}"
      style="--acc:${etapa(n.etapa).color}" draggable="${MODO_SEL ? 'false' : 'true'}">
    ${MODO_SEL ? `<input type="checkbox" class="chk" ${SEL.has(n.id) ? 'checked' : ''} data-chk="${n.id}">` : ''}
    <span class="nom">${esc(n.cliente || '—')}</span>
    <div class="linea"><span class="tag t-${cls}">${n.origen}</span>
      ${n.agente_nombre ? esc(n.agente_nombre) : '<span style="color:var(--warn)">Sin asignar</span>'}
      ${monto ? '· ' + monto : ''}</div>
    <div class="chips">${visibles.join('')}
      ${ocultos.length ? `<span class="mas" data-mas="${n.id}">+${ocultos.length}</span>` : ''}</div>
    ${ocultos.length ? `<div class="extra">${ocultos.join('')}</div>` : ''}
    ${sla}
    ${n.motivo ? `<div class="linea" style="margin-top:5px">Motivo: ${esc(n.motivo)}</div>` : ''}</div>`;
}

/* ---------- Drag & drop ---------- */
function conectarDrag() { $$('.card').forEach(conectarTarjeta); conectarColumnas(); }

function conectarTarjeta(el) {
  const id = el.dataset.id;
  el.ondragstart = e => { el.classList.add('drag'); e.dataTransfer.setData('id', id); e.dataTransfer.effectAllowed = 'move'; };
  el.ondragend = () => el.classList.remove('drag');
  el.onclick = e => {
    if (e.target.closest('[data-mas]')) { el.classList.toggle('abierta'); return; }
    if (e.target.closest('[data-chk]')) return;
    if (MODO_SEL) { toggleSel(id); return; }
    fichaNeg(id);
  };
  const chk = el.querySelector('[data-chk]');
  if (chk) chk.onclick = e => { e.stopPropagation(); toggleSel(id); };
}

function conectarColumnas() {
  $$('.col').forEach(col => {
    col.ondragover = e => { e.preventDefault(); col.classList.add('drop'); };
    col.ondragleave = () => col.classList.remove('drop');
    col.ondrop = async e => {
      e.preventDefault(); col.classList.remove('drop');
      const id = e.dataTransfer.getData('id');
      if (id) await mover(id, col.dataset.col);
    };
  });
}

function toggleSel(id) {
  SEL.has(id) ? SEL.delete(id) : SEL.add(id);
  const el = $(`[data-id="${id}"]`);
  if (el) { el.classList.toggle('sel', SEL.has(id)); const c = el.querySelector('[data-chk]'); if (c) c.checked = SEL.has(id); }
  const sn = $('#sel-n'); if (sn) sn.textContent = SEL.size;
  vibrar(8);
}

/* ---------- Mover de etapa ---------- */
export async function mover(id, destino, extra = {}) {
  const n = S.negociaciones.find(x => x.id === id);
  if (!n || n.etapa === destino) return;
  if (destino === 'ganado' && fx('montoObligatorio') && !(extra.monto > 0)) return modalGanado(id);
  if (destino === 'cerrado' && !extra.motivo) return modalMotivo(id);

  const el = $(`[data-id="${id}"]`);
  const body = $(`[data-body="${destino}"]`);
  const etapaPrevia = n.etapa;
  if (el && body) {
    bloquear(id);
    const vac = body.querySelector('.empty'); if (vac) vac.remove();
    destino === 'espera' ? body.appendChild(el) : body.prepend(el);
    el.style.setProperty('--acc', etapa(destino).color);
    actualizarContadores();
  }
  try {
    await patch(`/negociaciones/${id}/etapa`, { etapa: destino, ...extra });
    n.etapa = destino;
    if (extra.monto) n.monto_cierre = extra.monto;
    if (extra.motivo) n.motivo = extra.motivo;
    n.entrada_etapa = new Date().toISOString();
    bloqueadas.delete(id);
    setTimeout(() => patchTarjeta(id), 80);
    if (destino === 'ganado') { confeti(); vibrar([18, 50, 18]); toast(`Cerrado ganado por ${gs(extra.monto)}`, 'ok', '🎉 ¡Venta cerrada!'); }
    else toast(`Movido a ${etapa(destino).nombre}`, 'ok', 'Negociación');
  } catch (e) {
    bloqueadas.delete(id);
    const vuelta = $(`[data-body="${etapaPrevia}"]`);
    if (el && vuelta) { vuelta.prepend(el); el.style.setProperty('--acc', etapa(etapaPrevia).color); actualizarContadores(); }
    if (e.data?.error === 'duplicado') {
      toast(e.data.mensaje || 'Ya existe una negociación abierta', 'warn', 'Duplicado evitado');
      if (e.data.negociacionId) fichaNeg(e.data.negociacionId);
    } else if (e.data?.error === 'monto_requerido') modalGanado(id);
    else if (e.data?.error === 'motivo_requerido') modalMotivo(id);
    else toast(e.message, 'bad');
  }
}

function modalGanado(id) {
  const n = S.negociaciones.find(x => x.id === id) || {};
  modal(`<div class="modal-h"><h3>💰 Cerrar ganado · ${esc(n.cliente || '')}</h3><button class="x" data-cerrar>✕</button></div>
   <div class="modal-b"><p class="sub" style="margin-top:0">El monto de cierre es obligatorio para registrar la venta.</p>
   <div class="field"><label for="gm">Monto por el cual se cerró (Gs) *</label>
     <input id="gm" type="number" inputmode="numeric" min="1" value="${n.valor || ''}" placeholder="Ej: 3500000"></div>
   <div style="margin:-4px 0 12px;color:var(--muted);font-size:var(--fs-sm)">Vista previa: <b id="gm-p" style="color:var(--ok)">—</b></div>
   <div class="err" id="gm-err"></div></div>
   <div class="modal-f"><button class="btn ghost" data-cerrar>Cancelar</button>
   <button class="btn ok" id="gm-ok">Confirmar cierre ganado</button></div>`);
  const inp = $('#gm');
  const pre = () => $('#gm-p').textContent = inp.value ? gs(inp.value) : '—';
  inp.oninput = pre; pre();
  inp.onkeydown = e => { if (e.key === 'Enter') $('#gm-ok').click(); };
  $$('[data-cerrar]').forEach(b => b.onclick = cerrar);
  $('#gm-ok').onclick = () => {
    const m = Number(inp.value) || 0;
    if (m <= 0) return $('#gm-err').textContent = 'Ingresá un monto mayor a cero.';
    cerrar(); mover(id, 'ganado', { monto: m });
  };
}

function modalMotivo(id) {
  modal(`<div class="modal-h"><h3>Motivo de cierre</h3><button class="x" data-cerrar>✕</button></div>
   <div class="modal-b"><div class="field"><label for="mot">Motivo</label>
   <select id="mot">${(S.empresa.motivos || []).map(m => `<option>${esc(m)}</option>`).join('')}</select></div>
   <div class="field"><label for="motc">Comentario</label><textarea id="motc" rows="3" placeholder="Detalle opcional"></textarea></div></div>
   <div class="modal-f"><button class="btn ghost" data-cerrar>Cancelar</button>
   <button class="btn" id="mot-ok">Cerrar negociación</button></div>`);
  $$('[data-cerrar]').forEach(b => b.onclick = cerrar);
  $('#mot-ok').onclick = () => {
    const m = $('#mot').value, c = $('#motc').value.trim();
    cerrar(); mover(id, 'cerrado', { motivo: m + (c ? ' — ' + c : '') });
  };
}

/* ---------- Carga manual ---------- */
export function modalCargaManual(pre = {}) {
  const sucs = S.sucursales.map(s => s.nombre);
  const ahora = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  modal(`<div class="modal-h"><h3>✎ Cargar negociación que no ingresó</h3><button class="x" data-cerrar>✕</button></div>
  <div class="modal-b">
   <p class="sub" style="margin-top:0">Para conversaciones que no entraron al sistema. Queda con marcador
     <span class="tag t-man">✎ Manual</span> y auditada.</p>
   <div class="card-box"><h3>Datos del cliente</h3>
    <div class="row"><div class="field"><label>Nombre *</label><input id="m-nom" value="${esc(pre.nombre || '')}"></div>
     <div class="field"><label>Teléfono *</label><input id="m-tel" inputmode="tel" value="${esc(pre.tel || '')}"></div>
     <div class="field"><label>Email</label><input id="m-mail" inputmode="email"></div></div>
    <div id="m-dup"></div>
    <div class="row"><div class="field"><label>Documento</label><input id="m-doc"></div>
     <div class="field"><label>Ciudad</label><input id="m-ciu"></div>
     <div class="field"><label>Sucursal</label><select id="m-suc">${sucs.map(s => `<option>${esc(s)}</option>`).join('')}</select></div>
     <div class="field"><label>Línea</label><select id="m-lin">${(S.empresa.lineas || []).map(s => `<option>${esc(s)}</option>`).join('')}</select></div></div></div>
   <div class="card-box"><h3>Datos de la negociación</h3>
    <div class="row"><div class="field"><label>Origen real</label><select id="m-ori">
      ${ORIGENES.map(o => `<option ${pre.origen === o ? 'selected' : ''}>${o}</option>`).join('')}</select></div>
     <div class="field"><label>Canal</label><select id="m-canal"><option value="">—</option>
      ${canales.map(c => `<option value="${c.id}">${esc(c.nombre)}</option>`).join('')}</select></div>
     <div class="field"><label>Etapa inicial</label><select id="m-et">
      ${(S.empresa.etapas || []).map(e => `<option value="${e.id}" ${e.id === 'contactado' ? 'selected' : ''}>${esc(e.nombre)}</option>`).join('')}</select></div>
     <div class="field"><label>Responsable</label><select id="m-ag"><option value="">Asignación equitativa</option>
      ${usuarios.map(u => `<option value="${u.id}">${esc(u.nombre)} (${u.rol})</option>`).join('')}</select></div></div>
    <div class="row"><div class="field"><label>Fecha/hora real del contacto</label>
      <input id="m-fec" type="datetime-local" value="${pre.fecha || ahora}"></div>
     <div class="field"><label>Valor estimado (Gs)</label><input id="m-val" type="number" inputmode="numeric" value="0"></div></div>
    <div class="field"><label>Mensaje del cliente que no ingresó *</label>
     <textarea id="m-msg" rows="3" placeholder="Pegá o transcribí el mensaje original">${esc(pre.mensaje || '')}</textarea></div>
    <div class="field"><label>Adjunto que envió el cliente (opcional)</label>
      <div id="m-adj" hidden></div>
      <div class="row" style="position:relative"><button class="btn ghost sm" id="m-adjbtn" type="button">📎 Adjuntar archivo</button></div></div>
    <div class="field"><label>Respuesta del agente (opcional)</label><textarea id="m-res" rows="2"></textarea></div>
    <div class="field"><label>Motivo de la carga manual</label><select id="m-why">
      ${['Falla de conexión de WhatsApp', 'Mensaje perdido por el bot', 'Contacto presencial', 'Contacto por llamada', 'Derivación externa', 'Otro']
        .map(o => `<option ${pre.motivo === o ? 'selected' : ''}>${o}</option>`).join('')}</select></div></div>
   <div class="err" id="m-err"></div></div>
  <div class="modal-f"><button class="btn ghost" data-cerrar>Cancelar</button>
   <button class="btn" id="m-ok">Cargar negociación</button></div>`, true);

  $$('[data-cerrar]').forEach(b => b.onclick = cerrar);
  const adjM = conectarAdjuntos({ inputSel: '#m-msg', barraSel: '#m-adj', botonSel: '#m-adjbtn' });
  let tmr;
  $('#m-tel').oninput = e => { clearTimeout(tmr); tmr = setTimeout(() => chequearDuplicado(e.target.value, '#m-dup'), 350); };
  if (pre.tel) chequearDuplicado(pre.tel, '#m-dup');

  $('#m-ok').onclick = async () => {
    const b = {
      nombre: $('#m-nom').value.trim(), tel: $('#m-tel').value.trim(), email: $('#m-mail').value.trim(),
      doc: $('#m-doc').value.trim(), ciudad: $('#m-ciu').value.trim(), sucursal: $('#m-suc').value,
      linea: $('#m-lin').value, origen: $('#m-ori').value, canalId: $('#m-canal').value || null,
      etapa: $('#m-et').value, agenteId: $('#m-ag').value || null, fecha: $('#m-fec').value,
      valor: Number($('#m-val').value) || 0, mensaje: $('#m-msg').value.trim(),
      respuesta: $('#m-res').value.trim(), motivoCarga: $('#m-why').value,
      archivoId: adjM.archivo?.id || null
    };
    if (!b.nombre || !b.tel || !b.mensaje) return $('#m-err').textContent = 'Nombre, teléfono y mensaje son obligatorios.';
    const btn = $('#m-ok'); btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Cargando…';
    try {
      await post('/negociaciones/manual', b);
      cerrar(); toast(`Negociación cargada para ${b.nombre}`, 'ok', 'Carga manual'); vistaNegociaciones();
    } catch (e) {
      $('#m-err').innerHTML = esc(e.data?.mensaje || e.message);
      btn.disabled = false; btn.textContent = 'Cargar negociación';
    }
  };
}

export async function chequearDuplicado(tel, sel) {
  const box = $(sel); if (!box) return;
  if (!tel || tel.length < 6) { box.innerHTML = ''; return; }
  try {
    const d = await get(`/contactos/chequeo?tel=${encodeURIComponent(tel)}`);
    if (!d.duplicado) { box.innerHTML = ''; return; }
    box.innerHTML = `<div class="card-box fx-pop" style="margin:0 0 10px;border-color:var(--warn);padding:11px">
      <b style="font-size:var(--fs-sm)">⚠ Ese número ya tiene una negociación abierta</b>
      <div style="color:var(--muted);font-size:var(--fs-sm);margin-top:5px">
        ${esc(d.nombre)} · ${esc(d.etapaNombre)} · ${esc(d.agente || 'sin asignar')}</div>
      <button class="btn ghost sm" style="margin-top:8px" data-abrir="${d.id}">Abrir la existente</button></div>`;
    box.querySelector('[data-abrir]').onclick = () => { cerrar(); fichaNeg(d.id); };
  } catch (e) { box.innerHTML = ''; }
}

/* ---------- Eliminación ---------- */
async function borrarSeleccion() {
  if (!SEL.size) return toast('No hay negociaciones seleccionadas', 'warn');
  const ids = [...SEL];
  modal(`<div class="modal-h"><h3>🗑 Eliminar ${ids.length} negociación(es)</h3><button class="x" data-cerrar>✕</button></div>
   <div class="modal-b"><p class="sub" style="margin-top:0">Esta acción no se puede deshacer. Los contactos y su ficha 360° se conservan.</p>
    <div style="max-height:190px;overflow:auto;margin-bottom:12px">${ids.map(i => {
      const n = S.negociaciones.find(x => x.id === i) || {};
      return `<div style="padding:7px 0;border-bottom:1px solid var(--line);font-size:var(--fs-sm)">
        <b>${esc(n.cliente || '')}</b><span style="color:var(--muted)"> · ${esc(etapa(n.etapa).nombre)} · ${fd(n.creado)}</span></div>`;
    }).join('')}</div>
    <div class="field"><label>Motivo de la eliminación</label><input id="del-m" placeholder="Ej: duplicados, prueba, datos erróneos"></div>
    <div class="field"><label>Escribí <b>ELIMINAR</b> para confirmar</label><input id="del-c" placeholder="ELIMINAR"></div>
    <div class="err" id="del-e"></div></div>
   <div class="modal-f"><button class="btn ghost" data-cerrar>Cancelar</button>
    <button class="btn danger" id="del-ok">Eliminar definitivamente</button></div>`);
  $$('[data-cerrar]').forEach(b => b.onclick = cerrar);
  $('#del-ok').onclick = async () => {
    if ($('#del-c').value.trim().toUpperCase() !== 'ELIMINAR')
      return $('#del-e').textContent = 'Escribí ELIMINAR para confirmar.';
    const r = await post('/negociaciones/eliminar', { ids, motivo: $('#del-m').value.trim() });
    cerrar(); quitarTarjetas(ids); SEL.clear();
    toast(`${r.eliminadas} negociación(es) eliminada(s)`, 'warn', 'Eliminación');
  };
}

function modalMasivo() {
  modal(`<div class="modal-h"><h3>⚠ Eliminación masiva por filtro</h3><button class="x" data-cerrar>✕</button></div>
  <div class="modal-b"><p class="sub" style="margin-top:0">Solo afecta a <b>${esc(S.empresa.nombre)}</b>.</p>
   <div class="row"><div class="field"><label>Etapa</label><select id="bm-et"><option value="">Todas</option>
     ${(S.empresa.etapas || []).map(e => `<option value="${e.id}">${esc(e.nombre)}</option>`).join('')}</select></div>
    <div class="field"><label>Origen</label><select id="bm-or"><option value="">Todos</option>
      ${ORIGENES.map(o => `<option>${o}</option>`).join('')}</select></div>
    <div class="field"><label>Agente</label><select id="bm-ag"><option value="">Todos</option>
      ${usuarios.map(u => `<option value="${u.id}">${esc(u.nombre)}</option>`).join('')}</select></div></div>
   <div class="row"><div class="field"><label>Creadas desde</label><input id="bm-d1" type="date"></div>
    <div class="field"><label>Creadas hasta</label><input id="bm-d2" type="date"></div>
    <div class="field"><label>Marcador</label><select id="bm-mk"><option value="">Cualquiera</option>
      <option value="manual">Carga manual</option><option value="transferido">Transferido</option>
      <option value="regestionado">Re gestionado</option><option value="frecuente">Frecuente</option></select></div></div>
   <button class="btn ghost sm" id="bm-prev">Previsualizar coincidencias</button>
   <div id="bm-out" style="margin-top:12px"></div></div>
  <div class="modal-f"><button class="btn ghost" data-cerrar>Cancelar</button>
   <button class="btn danger" id="bm-ok">Eliminar coincidencias</button></div>`);
  $$('[data-cerrar]').forEach(b => b.onclick = cerrar);
  const datos = () => ({
    etapa: $('#bm-et').value || null, origen: $('#bm-or').value || null, agenteId: $('#bm-ag').value || null,
    desde: $('#bm-d1').value || null, hasta: $('#bm-d2').value ? $('#bm-d2').value + 'T23:59:59' : null,
    marcador: $('#bm-mk').value || null
  });
  $('#bm-prev').onclick = async () => {
    const r = await post('/negociaciones/eliminar-masivo', { ...datos(), soloPrevia: true });
    $('#bm-out').innerHTML = `<div class="card-box fx-pop" style="margin:0;border-color:${r.total ? 'var(--bad)' : 'var(--line)'}">
      <b style="font-size:var(--fs-sm)">${r.total} negociación(es) coinciden</b>
      <div style="max-height:170px;overflow:auto;margin-top:8px">${r.muestra.map(x =>
        `<div style="font-size:var(--fs-xs);padding:5px 0;border-bottom:1px solid var(--line)">
          ${esc(x.nombre)} · ${esc(etapa(x.etapa).nombre)} · ${fd(x.creado)}</div>`).join('') || '<div class="empty">Sin coincidencias</div>'}
      </div></div>`;
  };
  $('#bm-ok').onclick = async () => {
    const prev = await post('/negociaciones/eliminar-masivo', { ...datos(), soloPrevia: true });
    if (!prev.total) return toast('No hay coincidencias', 'warn');
    cerrar();
    if (!await confirmar('Eliminación masiva',
      `Se eliminarán <b>${prev.total}</b> negociación(es) de ${esc(S.empresa.nombre)}. Esta acción no se puede deshacer.`,
      'Eliminar todo')) return;
    const r = await post('/negociaciones/eliminar-masivo', datos());
    toast(`${r.eliminadas} negociación(es) eliminada(s)`, 'warn', 'Eliminación masiva');
    vistaNegociaciones();
  };
}
