/* ============ Comunicación · Calendario · Reportes · Configuración ============ */
import { guirnalda } from './animaciones.js';
import {
  $, $$, esc, S, get, post, patch, del, put, gs, fd, fdate, ago, fechaISO, iniciales, toast,
  modal, cerrar, confirmar, fx, esAdmin, esMando, etapa, bajar, vacio, skeleton,
  DISPONIBILIDAD, ORIGENES, TIPOS_EV, aplicarTema, aplicarFX
} from './core.js';
import { fichaNeg, modalRapidas } from './ficha.js';
import { conectarEmojis } from './emojis.js';
import { actualizarMensajes } from './chat-mensajes.js';
import { enlazarTexto } from './enlaces.js';

/* ================= COMUNICACIÓN ================= */
let CHAT = null, resumenCom = { grupos: [], usuarios: [] };

export async function vistaComunicacion() {
  if (!fx('comunicacion')) {
    $('#view').innerHTML = `<div class="section"><div class="card-box">El módulo de comunicación interna está desactivado por el administrador.</div></div>`;
    return;
  }
  resumenCom = await get('/com/resumen');
  const { grupos, usuarios } = resumenCom;
  if (!CHAT) CHAT = grupos.length ? { tipo: 'grupo', id: grupos[0].id } : (usuarios[0] ? { tipo: 'dm', id: usuarios[0].id } : null);

  $('#view').innerHTML = `<div class="section fx-vista com-section"><div class="ci">
   <div class="ci-side">
     <div style="padding:11px 13px;border-bottom:1px solid var(--line);display:flex;gap:7px;align-items:center">
       <b style="flex:1;font-size:var(--fs-xs);color:var(--muted);letter-spacing:.4px">GRUPOS</b>
       ${(esAdmin() || fx('gruposAgente')) ? `<button class="btn sm" id="g-nuevo">+</button>` : ''}</div>
     ${grupos.map(g => `<div class="ci-i ${CHAT?.tipo === 'grupo' && CHAT.id === g.id ? 'sel' : ''}" data-chat="grupo" data-id="${g.id}">
        <div class="avatar" style="background:linear-gradient(135deg,var(--brand),#7c5cff);color:#fff">#</div>
        <div style="flex:1;min-width:0"><b>${esc(g.nombre)}</b><small>${(g.miembros || []).length} miembros</small></div>
        ${Number(g.no_leidos) ? '<span class="unread-dot"></span>' : ''}</div>`).join('')
       || '<div class="empty">Sin grupos</div>'}
     <div style="padding:11px 13px;border-top:1px solid var(--line);border-bottom:1px solid var(--line)">
       <b style="font-size:var(--fs-xs);color:var(--muted);letter-spacing:.4px">EMPLEADOS</b></div>
     ${usuarios.map(u => {
       const d = DISPONIBILIDAD.find(x => x.id === u.disponibilidad) || {};
       return `<div class="ci-i ${CHAT?.tipo === 'dm' && CHAT.id === u.id ? 'sel' : ''}" data-chat="dm" data-id="${u.id}">
        <div class="avatar">${u.foto ? `<img src="${esc(u.foto)}" alt="">` : iniciales(u.nombre)}</div>
        <div style="flex:1;min-width:0"><b>${esc(u.nombre)}</b>
          <small><span class="dot" style="background:${d.c || '#666'}"></span> ${esc(d.t || '—')} · ${esc(u.sucursal || '')}</small></div>
        ${Number(u.no_leidos) ? '<span class="unread-dot"></span>' : ''}</div>`;
     }).join('')}
   </div><div class="ci-main" id="ci-main"></div></div></div>`;

  $$('[data-chat]').forEach(el => el.onclick = () => { CHAT = { tipo: el.dataset.chat, id: el.dataset.id }; vistaComunicacion(); });
  if ($('#g-nuevo')) $('#g-nuevo').onclick = () => modalGrupo();
  await pintarChat();
}

async function pintarChat(suave = false, seguir = false) {
  const box = $('#ci-main'); if (!box) return;
  if (!CHAT) { box.innerHTML = vacio('✉', 'Elegí una conversación', ''); return; }
  const chat = { ...CHAT }, clave = `${chat.tipo}:${chat.id}`;
  const actualizar = suave && box.dataset.chatKey === clave && $('#ci-body');
  if (!actualizar) box.innerHTML = `<div style="margin:auto"><span class="spin lg"></span></div>`;
  const revision = box._revision = (box._revision || 0) + 1;
  const msgs = await get(`/com/mensajes?tipo=${chat.tipo}&id=${chat.id}`);
  if ($('#ci-main') !== box || `${CHAT?.tipo}:${CHAT?.id}` !== clave || box._revision !== revision) return;
  const render = m => `<div class="msg ${m.de_id === S.usuario.id ? 'out' : 'in'}">
    ${chat.tipo === 'grupo' && m.de_id !== S.usuario.id ? `<b style="font-size:var(--fs-xs);color:var(--brand);display:block">${esc(m.autor)}</b>` : ''}
    <div class="message-text">${enlazarTexto(m.txt)}</div><small>${fdate(m.ts)}</small></div>`;
  if (actualizar) { actualizarMensajes($('#ci-body'), msgs, render, seguir); return; }
  box.dataset.chatKey = clave;
  const esGrupo = CHAT.tipo === 'grupo';
  let titulo, sub;
  if (esGrupo) {
    const g = resumenCom.grupos.find(x => x.id === CHAT.id) || {};
    titulo = '# ' + (g.nombre || ''); sub = g.descripcion || `${(g.miembros || []).length} miembros`;
  } else {
    const u = resumenCom.usuarios.find(x => x.id === CHAT.id) || {};
    const d = DISPONIBILIDAD.find(x => x.id === u.disponibilidad) || {};
    titulo = u.nombre || ''; sub = `${d.t || ''} · ${u.rol || ''} · ${u.sucursal || ''}`;
  }
  box.innerHTML = `<div class="ci-h"><div class="avatar">${esGrupo ? '#' : iniciales(titulo)}</div>
     <div style="flex:1"><b style="font-size:var(--fs-md)">${esc(titulo)}</b>
       <div style="color:var(--muted);font-size:var(--fs-xs)">${esc(sub)}</div></div>
     ${esGrupo && esAdmin() ? `<button class="btn ghost sm" id="g-editar">Editar grupo</button>` : ''}</div>
   <div class="ci-body" id="ci-body"></div>
   <div class="ci-f"><textarea id="ci-msg" rows="3" enterkeyhint="enter" aria-label="Mensaje interno" placeholder="Escribir mensaje…"></textarea>
     <button class="btn" id="ci-enviar">Enviar</button></div>`;
  actualizarMensajes($('#ci-body'), msgs, render, true);
  conectarEmojis('#ci-msg');
  let enviando = false;
  const input = $('#ci-msg'), boton = $('#ci-enviar');
  boton.onpointerdown = e => { if (document.activeElement === input) e.preventDefault(); };
  const enviar = async () => {
    if (enviando) return;
    const borrador = input.value, txt = borrador.trim(); if (!txt) return;
    enviando = true; boton.disabled = true; input.value = '';
    try { await post('/com/mensajes', { tipo: chat.tipo, id: chat.id, texto: txt }); }
    catch (e) { input.value = input.value ? borrador + '\n' + input.value : borrador; toast(e.message, 'bad'); return; }
    finally { enviando = false; boton.disabled = false; }
    if ($('#ci-main') === box && box.dataset.chatKey === clave) {
      try { await pintarChat(true, true); } catch { toast('Mensaje guardado. No se pudo actualizar la conversación.', 'warn'); }
    }
  };
  $('#ci-enviar').onclick = enviar;
  actualizarBadgeCom();
}

export function refrescarChat(evento) {
  if (S.vista === 'com' && (!evento || (evento.tipo === CHAT?.tipo && evento.id === CHAT?.id)))
    pintarChat(true).catch(e => toast(e.message, 'bad'));
}

function actualizarBadgeCom() {
  const total = resumenCom.grupos.reduce((a, g) => a + Number(g.no_leidos || 0), 0)
    + resumenCom.usuarios.reduce((a, u) => a + Number(u.no_leidos || 0), 0);
  const b = $('[data-nav="com"] .bdg');
  if (b) { b.textContent = total || ''; b.style.display = total ? '' : 'none'; }
}

async function modalGrupo(gid) {
  const us = await get('/admin/usuarios');
  const g = gid ? resumenCom.grupos.find(x => x.id === gid) : null;
  modal(`<div class="modal-h"><h3>${g ? 'Editar grupo' : 'Nuevo grupo interno'}</h3><button class="x" data-cerrar>✕</button></div>
  <div class="modal-b">
   <div class="field"><label>Nombre del grupo</label><input id="g-nom" value="${g ? esc(g.nombre) : ''}" placeholder="ej: Ventas Central"></div>
   <div class="field"><label>Descripción</label><input id="g-desc" value="${g ? esc(g.descripcion || '') : ''}"></div>
   <div class="field"><label>Miembros</label><div class="grid g2" style="gap:6px;max-height:240px;overflow:auto;padding:4px">
     ${us.map(u => `<label style="font-size:var(--fs-sm);display:flex;gap:7px;align-items:center;padding:8px;background:var(--surface2);border-radius:9px">
       <input type="checkbox" data-mb="${u.id}" ${g ? ((g.miembros || []).includes(u.id) ? 'checked' : '') : (u.id === S.usuario.id ? 'checked' : '')}>
       ${esc(u.nombre)} <span class="badge-rol">${u.rol}</span></label>`).join('')}</div></div></div>
  <div class="modal-f">${g ? `<button class="btn danger" id="g-del">Eliminar</button>` : ''}
   <button class="btn ghost" data-cerrar>Cancelar</button><button class="btn" id="g-ok">Guardar</button></div>`);
  $$('[data-cerrar]').forEach(b => b.onclick = cerrar);
  $('#g-ok').onclick = async () => {
    const nombre = $('#g-nom').value.trim(); if (!nombre) return toast('Poné un nombre', 'warn');
    const miembros = $$('[data-mb]').filter(c => c.checked).map(c => c.dataset.mb);
    const body = { nombre, descripcion: $('#g-desc').value.trim(), miembros };
    if (g) await patch(`/com/grupos/${g.id}`, body);
    else { const r = await post('/com/grupos', body); CHAT = { tipo: 'grupo', id: r.grupo.id }; }
    cerrar(); toast('Grupo guardado', 'ok'); vistaComunicacion();
  };
  if ($('#g-del')) $('#g-del').onclick = async () => {
    if (!await confirmar('Eliminar grupo', `Se eliminará <b>${esc(g.nombre)}</b> y todos sus mensajes.`, 'Eliminar')) return;
    await del(`/com/grupos/${g.id}`); CHAT = null; cerrar(); toast('Grupo eliminado', 'warn'); vistaComunicacion();
  };
}

/* ================= CALENDARIO ================= */
let CAL = { m: new Date().getMonth(), a: new Date().getFullYear() }, datosCal = null;

export async function vistaCalendario() {
  if (!fx('calendario')) {
    $('#view').innerHTML = `<div class="section"><div class="card-box">El calendario está desactivado por el administrador.</div></div>`;
    return;
  }
  $('#view').innerHTML = `<div class="section">${skeleton(4)}</div>`;
  datosCal = await get(`/calendario?anio=${CAL.a}`);
  pintarCalendario();
}

function eventosDelDia(iso) {
  const out = [];
  if (fx('cumpleanos')) {
    (datosCal.cumples || []).filter(c => c.md === iso.slice(5)).forEach(c => {
      const ed = CAL.a - Number(c.anio_nac);
      out.push({ tipo: 'cumple', titulo: `🎂 ${c.nombre}${ed > 0 ? ` (${ed})` : ''}` });
    });
  }
  (datosCal.feriados || []).filter(f => f.fecha === iso).forEach(f => out.push({ tipo: 'feriado', titulo: '🏖 ' + f.titulo }));
  (datosCal.eventos || []).filter(e => String(e.fecha).slice(0, 10) === iso).forEach(e =>
    out.push({ ...e, titulo: (e.hora ? e.hora + ' ' : '') + e.titulo }));
  return out;
}
const claseEv = t => ({ cumple: 'cum', feriado: 'fer', reunion: 'reu', capacitacion: 'cap' }[t] || 'act');

function pintarCalendario() {
  const prim = new Date(CAL.a, CAL.m, 1), dias = new Date(CAL.a, CAL.m + 1, 0).getDate(), off = prim.getDay();
  const hoy = fechaISO(new Date());
  const meses = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  let celdas = '<div class="cal-d off"></div>'.repeat(off);
  for (let d = 1; d <= dias; d++) {
    const iso = `${CAL.a}-${String(CAL.m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const evs = eventosDelDia(iso), fer = evs.some(e => e.tipo === 'feriado');
    celdas += `<div class="cal-d ${iso === hoy ? 'hoy' : ''} ${fer ? 'fer' : ''}" data-dia="${iso}">
      <div class="nd">${d}</div>${evs.slice(0, 3).map(e => `<div class="ev ${claseEv(e.tipo)}">${esc(e.titulo)}</div>`).join('')}
      ${evs.length > 3 ? `<div class="ev" style="background:transparent;color:var(--muted)">+${evs.length - 3} más</div>` : ''}</div>`;
  }
  const prox = proximos(30);
  const cumpleHoy = fx('cumpleanos') ? (datosCal.cumples || []).filter(c => c.md === hoy.slice(5)).map(c => c.nombre.split(' ')[0]) : [];
  $('#view').innerHTML = `<div class="section fx-vista">
   ${cumpleHoy.length ? guirnalda(cumpleHoy) : ''}
   <div class="row" style="align-items:center;margin-bottom:14px">
     <div style="flex:none;display:flex;gap:7px;align-items:center">
       <button class="btn ghost sm" id="cal-prev">‹</button>
       <b style="font-size:var(--fs-lg);min-width:180px;text-align:center;display:inline-block">${meses[CAL.m]} ${CAL.a}</b>
       <button class="btn ghost sm" id="cal-next">›</button>
       <button class="btn ghost sm" id="cal-hoy">Hoy</button></div>
     <div></div>
     <div style="flex:none"><button class="btn" id="cal-nuevo">+ Nuevo evento</button></div></div>
   ${datosCal.sinNacimiento?.length && esMando() ? `<div class="card-box" style="border-color:var(--warn)">
     <b style="font-size:var(--fs-sm)">⚠ ${datosCal.sinNacimiento.length} persona(s) sin fecha de nacimiento</b>
     <div style="color:var(--muted);font-size:var(--fs-sm);margin-top:5px">${datosCal.sinNacimiento.map(esc).join(', ')}</div></div>` : ''}
   <div class="grid" style="grid-template-columns:1fr 310px">
     <div class="card-box"><div class="cal">
       ${['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'].map(d => `<div class="cal-h">${d}</div>`).join('')}${celdas}</div>
       <div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:13px;font-size:var(--fs-xs)">
         <span class="ev cum">Cumpleaños</span><span class="ev fer">Feriado</span>
         <span class="ev act">Actividad</span><span class="ev reu">Reunión</span><span class="ev cap">Capacitación</span></div></div>
     <div><div class="card-box"><h3>Próximos 30 días</h3>
       ${prox.map(p => `<div style="display:flex;gap:9px;padding:9px 0;border-bottom:1px solid var(--line);cursor:pointer" data-dia="${p.iso}">
         <div style="text-align:center;min-width:38px"><b style="font-size:var(--fs-lg);display:block">${p.iso.slice(8)}</b>
           <small style="color:var(--muted);font-size:10px">${['ENE','FEB','MAR','ABR','MAY','JUN','JUL','AGO','SEP','OCT','NOV','DIC'][+p.iso.slice(5,7)-1]}</small></div>
         <div style="flex:1;min-width:0"><b style="font-size:var(--fs-sm);display:block">${esc(p.ev.titulo)}</b>
           <small style="color:var(--muted)">${p.dias === 0 ? 'Hoy' : p.dias === 1 ? 'Mañana' : 'En ' + p.dias + ' días'}</small></div></div>`).join('')
         || vacio('📅', 'Sin eventos próximos', '')}</div>
       <div class="card-box"><h3>🎂 Cumpleaños del equipo</h3>
        ${(datosCal.cumples || []).map(c => `<div style="display:flex;gap:9px;align-items:center;padding:7px 0;border-bottom:1px solid var(--line)">
          <div class="avatar" style="width:28px;height:28px;font-size:12px">${c.foto ? `<img src="${esc(c.foto)}" alt="">` : iniciales(c.nombre)}</div>
          <div style="flex:1"><b style="font-size:var(--fs-sm)">${esc(c.nombre)}</b></div>
          <small style="color:var(--muted)">${c.md.slice(3)}/${c.md.slice(0,2)}</small></div>`).join('')
          || vacio('🎂', 'Sin fechas cargadas', 'Se completan desde el perfil')}</div></div></div></div>`;

  $('#cal-prev').onclick = () => { CAL.m--; if (CAL.m < 0) { CAL.m = 11; CAL.a--; } vistaCalendario(); };
  $('#cal-next').onclick = () => { CAL.m++; if (CAL.m > 11) { CAL.m = 0; CAL.a++; } vistaCalendario(); };
  $('#cal-hoy').onclick = () => { CAL = { m: new Date().getMonth(), a: new Date().getFullYear() }; vistaCalendario(); };
  $('#cal-nuevo').onclick = () => modalEvento();
  $$('[data-dia]').forEach(el => el.onclick = () => modalDia(el.dataset.dia));
}

function proximos(dias) {
  const out = [], hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  for (let i = 0; i < dias && out.length < 14; i++) {
    const iso = fechaISO(new Date(hoy.getTime() + i * 86400000));
    eventosDelDia(iso).forEach(ev => out.push({ iso, ev, dias: i }));
  }
  return out.slice(0, 14);
}

function modalDia(iso) {
  const evs = eventosDelDia(iso), d = new Date(iso + 'T12:00:00');
  modal(`<div class="modal-h"><h3>${d.toLocaleDateString('es-PY', { weekday:'long', day:'numeric', month:'long', year:'numeric' })}</h3>
    <button class="x" data-cerrar>✕</button></div>
  <div class="modal-b">${evs.length ? evs.map(e => `<div class="card-box" style="margin-bottom:9px;padding:12px">
     <div style="display:flex;gap:9px;align-items:center"><span class="ev ${claseEv(e.tipo)}">${e.tipo}</span>
       <b style="flex:1;font-size:var(--fs-sm)">${esc(e.titulo)}</b>
       ${e.id && esMando() ? `<button class="btn danger sm" data-delev="${e.id}">✕</button>` : ''}</div>
     ${e.descripcion ? `<div style="color:var(--muted);font-size:var(--fs-sm);margin-top:6px">${esc(e.descripcion)}</div>` : ''}
     ${e.sucursal ? `<div style="color:var(--muted);font-size:var(--fs-xs);margin-top:4px">📍 ${esc(e.sucursal)}</div>` : ''}
     ${e.creado_por ? `<div style="color:var(--muted);font-size:var(--fs-xs);margin-top:4px">Creado por ${esc(e.creado_por)}</div>` : ''}
    </div>`).join('') : vacio('📅', 'Sin eventos este día', '')}</div>
  <div class="modal-f"><button class="btn ghost" data-cerrar>Cerrar</button>
    <button class="btn" id="d-nuevo">+ Agregar evento</button></div>`);
  $$('[data-cerrar]').forEach(b => b.onclick = cerrar);
  $('#d-nuevo').onclick = () => modalEvento(iso);
  $$('[data-delev]').forEach(b => b.onclick = async () => {
    await del(`/calendario/${b.dataset.delev}`); cerrar(); toast('Evento eliminado', 'warn'); vistaCalendario();
  });
}

function modalEvento(iso) {
  modal(`<div class="modal-h"><h3>Nuevo evento</h3><button class="x" data-cerrar>✕</button></div>
  <div class="modal-b">
   <div class="row"><div class="field"><label>Título *</label><input id="ev-t" placeholder="Ej: Capacitación de producto"></div>
    <div class="field"><label>Tipo</label><select id="ev-tp">${TIPOS_EV.map(t => `<option value="${t.k}">${t.t}</option>`).join('')}</select></div></div>
   <div class="row"><div class="field"><label>Fecha *</label><input id="ev-f" type="date" value="${iso || fechaISO(new Date())}"></div>
    <div class="field"><label>Hora</label><input id="ev-h" type="time"></div>
    <div class="field"><label>Sucursal</label><select id="ev-s"><option value="">Todas</option>
      ${S.sucursales.map(s => `<option ${S.usuario.sucursal === s.nombre ? 'selected' : ''}>${esc(s.nombre)}</option>`).join('')}</select></div></div>
   <div class="field"><label>Descripción</label><textarea id="ev-d" rows="2"></textarea></div>
   <label style="font-size:var(--fs-sm);color:var(--muted)"><input type="checkbox" id="ev-n" checked> Notificar al equipo</label>
   <div class="err" id="ev-e"></div></div>
  <div class="modal-f"><button class="btn ghost" data-cerrar>Cancelar</button>
   <button class="btn" id="ev-ok">Guardar evento</button></div>`);
  $$('[data-cerrar]').forEach(b => b.onclick = cerrar);
  $('#ev-ok').onclick = async () => {
    const t = $('#ev-t').value.trim(), f = $('#ev-f').value;
    if (!t || !f) return $('#ev-e').textContent = 'Título y fecha son obligatorios.';
    await post('/calendario', { titulo: t, fecha: f, tipo: $('#ev-tp').value, hora: $('#ev-h').value,
      descripcion: $('#ev-d').value.trim(), sucursal: $('#ev-s').value, notificar: $('#ev-n').checked });
    cerrar(); toast('Evento agregado al calendario', 'ok'); vistaCalendario();
  };
}

/* ================= REPORTES ================= */
// La vista vive en reportes.js; se reexporta para no cambiar los imports existentes.
export { vistaReportes } from './reportes.js';

/* ================= CONFIGURACIÓN DEL USUARIO ================= */
export async function vistaConfig() {
  const p = await get('/perfil');
  const d = DISPONIBILIDAD.find(x => x.id === p.disponibilidad) || {};
  const suc = S.sucursales.find(s => s.nombre === p.sucursal);

  $('#view').innerHTML = `<div class="section fx-vista"><div class="grid g2">
    <div class="card-box"><h3>Mi perfil</h3>
      <div style="display:flex;gap:14px;align-items:center;margin-bottom:14px">
        <div class="avatar" style="width:64px;height:64px;font-size:20px">
          ${p.foto ? `<img src="${esc(p.foto)}" alt="">` : iniciales(p.nombre)}</div>
        <div><button class="btn ghost sm" id="p-foto">Cambiar foto</button>
        ${p.foto ? `<button class="btn ghost sm" id="p-quitar">Quitar</button>` : ''}
        <input id="p-file" type="file" accept="image/*" class="hidden"></div></div>
      <div class="row"><div class="field"><label>Nombre</label><input id="p-nom" value="${esc(p.nombre)}"></div>
        <div class="field"><label>Usuario</label><input value="${esc(p.usuario)}" disabled></div></div>
      <div class="row"><div class="field"><label>Email</label><input id="p-mail" value="${esc(p.email || '')}"></div>
        <div class="field"><label>Teléfono</label><input id="p-tel" value="${esc(p.tel || '')}"></div>
        <div class="field"><label>🎂 Nacimiento ${fx('natalicioObligatorio') ? '*' : ''}</label>
          <input id="p-nac" type="date" value="${p.nacimiento ? String(p.nacimiento).slice(0,10) : ''}" max="${fechaISO(new Date())}"></div></div>
      <div class="row"><div class="field"><label>Sucursal</label><input value="${esc(p.sucursal || '')}" disabled></div>
        <div class="field"><label>Línea</label><input value="${esc(p.linea || '')}" disabled></div>
        <div class="field"><label>Rol</label><input value="${p.rol}" disabled></div></div>
      <button class="btn sm" id="p-guardar">Guardar</button></div>

    <div class="card-box"><h3>Seguridad, apariencia y disponibilidad</h3>
      <div class="field"><label>Contraseña actual</label><input id="p-p0" type="password"></div>
      <div class="field"><label>Nueva contraseña</label><input id="p-p1" type="password"></div>
      <button class="btn sm" id="p-pass">Cambiar contraseña</button>
      <hr style="border:0;border-top:1px solid var(--line);margin:16px 0">
      <div class="row"><div class="field"><label>Tema</label><select id="p-tema">
        <option value="oscuro" ${S.tema === 'oscuro' ? 'selected' : ''}>Oscuro</option>
        <option value="claro" ${S.tema === 'claro' ? 'selected' : ''}>Claro</option></select></div>
       <div class="field"><label>Densidad</label><select id="p-dens">
        <option value="comoda" ${S.densidad === 'comoda' ? 'selected' : ''}>Cómoda</option>
        <option value="compacta" ${S.densidad === 'compacta' ? 'selected' : ''}>Compacta</option></select></div></div>
      <hr style="border:0;border-top:1px solid var(--line);margin:16px 0">
      <div style="margin-bottom:10px"><span class="dot" style="background:${d.c}"></span> Estado: <b>${esc(d.t || '—')}</b></div>
      <button class="btn ghost sm" id="p-disp">Marcar disponibilidad</button>
      ${fx('respuestasRapidas') ? `<button class="btn ghost sm" id="p-rapidas">⚡ Mis respuestas rápidas</button>` : ''}
      <h3 style="margin-top:16px">Últimas marcaciones</h3>
      <div class="mono" style="color:var(--muted);max-height:130px;overflow:auto">
        ${(p.marcaciones || []).map(m => `${fdate(m.ts)} → ${(DISPONIBILIDAD.find(x => x.id === m.estado)||{}).t || m.estado}`).join('<br>') || 'Sin marcaciones'}</div></div></div>
   ${suc ? `<div class="card-box"><h3>📍 Mi sucursal · ${esc(suc.nombre)}</h3>
     <div style="color:var(--muted);font-size:var(--fs-sm);line-height:1.8">
       ${suc.direccion ? '🏠 ' + esc(suc.direccion) + '<br>' : ''}🌆 ${esc(suc.ciudad || '—')}<br>
       ${suc.tel ? '📞 ' + esc(suc.tel) + '<br>' : ''}${suc.email ? '✉ ' + esc(suc.email) + '<br>' : ''}
       🕐 ${esc(suc.horario || '—')}</div></div>` : ''}
   ${fx('stock') && S.empresa.stock?.link ? `<div class="card-box"><h3>Catálogo / Stock</h3>
     <p style="color:var(--muted);font-size:var(--fs-sm);margin-top:0">${esc(S.empresa.stock.nota || 'Catálogo publicado por el administrador.')}</p>
     <a class="btn sm" href="${esc(S.empresa.stock.link)}" target="_blank" rel="noopener">Abrir catálogo</a></div>` : ''}</div>`;

  $('#p-foto').onclick = () => $('#p-file').click();
  $('#p-file').onchange = e => {
    const f = e.target.files[0]; if (!f) return;
    if (f.size > 900000) return toast('La imagen no puede superar 900 KB', 'warn');
    const rd = new FileReader();
    rd.onload = async () => { await patch('/perfil', { foto: rd.result }); toast('Foto actualizada', 'ok'); vistaConfig(); };
    rd.readAsDataURL(f);
  };
  if ($('#p-quitar')) $('#p-quitar').onclick = async () => { await patch('/perfil', { foto: '' }); vistaConfig(); };
  $('#p-guardar').onclick = async () => {
    const nac = $('#p-nac').value;
    if (fx('natalicioObligatorio') && !nac) return toast('La fecha de nacimiento es obligatoria', 'bad');
    await patch('/perfil', { nombre: $('#p-nom').value.trim(), email: $('#p-mail').value.trim(),
      tel: $('#p-tel').value.trim(), nacimiento: nac });
    toast('Perfil actualizado', 'ok');
  };
  $('#p-pass').onclick = async () => {
    try {
      await post('/perfil/password', { actual: $('#p-p0').value, nueva: $('#p-p1').value });
      toast('Contraseña actualizada', 'ok'); $('#p-p0').value = ''; $('#p-p1').value = '';
    } catch (e) { toast(e.message, 'bad'); }
  };
  $('#p-tema').onchange = e => { S.tema = e.target.value; localStorage.setItem('iciia_tema', S.tema); aplicarTema(); };
  $('#p-dens').onchange = e => { S.densidad = e.target.value; localStorage.setItem('iciia_densidad', S.densidad); aplicarTema(); };
  $('#p-disp').onclick = () => import('./app.js').then(m => m.modalDisponibilidad());
  if ($('#p-rapidas')) $('#p-rapidas').onclick = modalRapidas;
}
