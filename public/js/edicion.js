/* ============ Edición completa (administrador) ============ */
import { $, $$, esc, S, get, put, toast, modal, cerrar, fd, fdate, etapa, ORIGENES, ROLES, vacio } from './core.js';

let sub = 'empleados', usuarios = [], QB = '';

export async function vistaEdicion() {
  const cont = $('#adm-body');
  cont.innerHTML = `
   <div class="card-box" style="border-color:#2b5a7a">
     <h3>✏ Editar datos</h3>
     <div style="color:var(--muted);font-size:var(--fs-sm);line-height:1.7">
       Corregí cualquier dato de <b>${esc(S.empresa.nombre)}</b>: empleados y su jefe, clientes y su responsable,
       negociaciones con su fecha de creación. Cada cambio queda registrado en Auditoría.</div></div>
   <div class="tabs" style="margin-bottom:12px">
     ${[['empleados', '👥 Empleados'], ['clientes', '◎ Clientes'], ['negociaciones', '◫ Negociaciones']].map(([k, t]) =>
       `<button class="tab ${sub === k ? 'active' : ''}" data-sub="${k}">${t}</button>`).join('')}</div>
   <div id="ed-body"></div>`;
  $$('[data-sub]').forEach(b => b.onclick = () => { sub = b.dataset.sub; QB = ''; vistaEdicion(); });
  usuarios = await get('/edicion/usuarios');
  ({ empleados, clientes, negociaciones })[sub]();
}
const EB = () => $('#ed-body');
const buscador = ph => `<input id="ed-q" placeholder="${ph}" value="${esc(QB)}"
  style="width:100%;padding:10px 13px;margin-bottom:12px;background:var(--surface2);border:1px solid var(--line);border-radius:10px">`;
function conectarBuscador(fn) {
  let t; const i = $('#ed-q');
  if (i) i.oninput = e => { clearTimeout(t); QB = e.target.value; t = setTimeout(fn, 320); };
}
const jefes = () => usuarios.filter(u => u.rol === 'jefe' && u.activo);
const opcionesSelect = (lista, valor) => lista.map(([v, t]) =>
  `<option value="${esc(v)}" ${String(valor ?? '') === String(v) ? 'selected' : ''}>${esc(t)}</option>`).join('');

/* ================= EMPLEADOS ================= */
function empleados() {
  const orden = { gerente: 0, soporte: 1, jefe: 2, agente: 3 };
  const lista = [...usuarios].sort((a, b) => (orden[a.rol] ?? 9) - (orden[b.rol] ?? 9) || a.nombre.localeCompare(b.nombre));
  EB().innerHTML = `<div class="card-box"><table><thead><tr>
     <th>Nombre</th><th>Usuario</th><th>Rol</th><th class="hide-m">Sucursal</th><th>Jefe</th>
     <th class="hide-m">A cargo</th><th>Estado</th><th></th></tr></thead>
   <tbody>${lista.map(u => `<tr><td><b>${esc(u.nombre)}</b></td><td class="mono">${esc(u.usuario)}</td>
     <td><span class="badge-rol">${u.rol}</span></td><td class="hide-m">${esc(u.sucursal || '—')}</td>
     <td>${u.rol === 'agente' ? (u.jefe_nombre ? esc(u.jefe_nombre) : '<span style="color:var(--warn)">sin jefe</span>') : '—'}</td>
     <td class="hide-m">${u.rol === 'jefe' ? u.a_cargo + ' agente(s)' : '—'}</td>
     <td>${u.activo ? '<span style="color:var(--ok)">Activo</span>' : '<span style="color:var(--bad)">Inactivo</span>'}</td>
     <td style="text-align:right"><button class="btn ghost sm" data-eu="${u.id}">✏ Editar</button></td></tr>`).join('')
     || `<tr><td colspan="8">${vacio('👥', 'Sin empleados', '')}</td></tr>`}</tbody></table></div>`;
  $$('[data-eu]').forEach(b => b.onclick = () => modalEmpleado(usuarios.find(x => x.id === b.dataset.eu)));
}

function modalEmpleado(u) {
  const sucs = S.sucursales.map(s => [s.nombre, s.nombre]);
  modal(`<div class="modal-h"><h3>✏ ${esc(u.nombre)}</h3><button class="x" data-cerrar>✕</button></div>
   <div class="modal-b">
    <div class="row"><div class="field"><label>Nombre completo</label><input id="u-nom" value="${esc(u.nombre)}"></div>
     <div class="field"><label>Usuario de acceso</label><input id="u-usr" value="${esc(u.usuario)}" autocapitalize="off"></div></div>
    <div class="row"><div class="field"><label>Rol</label><select id="u-rol">
       ${opcionesSelect(ROLES.map(r => [r, r]), u.rol)}</select></div>
     <div class="field"><label>Jefe directo</label><select id="u-jef"><option value="">— Sin jefe —</option>
       ${opcionesSelect(jefes().filter(j => j.id !== u.id).map(j => [j.usuario, `${j.nombre} · ${j.sucursal || ''}`]), u.equipo)}</select></div></div>
    <div class="row"><div class="field"><label>Sucursal</label><select id="u-suc">${opcionesSelect(sucs, u.sucursal)}</select></div>
     <div class="field"><label>Línea</label><select id="u-lin"><option value="">—</option>
       ${opcionesSelect((S.empresa.lineas || []).map(l => [l, l]), u.linea)}</select></div></div>
    <div class="row"><div class="field"><label>Email</label><input id="u-mail" value="${esc(u.email || '')}" inputmode="email"></div>
     <div class="field"><label>Teléfono</label><input id="u-tel" value="${esc(u.tel || '')}" inputmode="tel"></div>
     <div class="field"><label>🎂 Nacimiento</label><input id="u-nac" type="date" value="${u.nacimiento ? String(u.nacimiento).slice(0, 10) : ''}"></div></div>
    <div class="field"><label>Nueva contraseña (dejar vacío para no cambiarla)</label>
      <input id="u-pass" type="password" autocomplete="new-password"></div>
    <label style="display:flex;gap:8px;align-items:center;font-size:var(--fs-sm)">
      <span class="sw"><input type="checkbox" id="u-act" ${u.activo ? 'checked' : ''}><i></i></span> Empleado activo</label>
    ${u.rol === 'jefe' && Number(u.a_cargo) ? `<div style="color:var(--warn);font-size:var(--fs-xs);margin-top:10px">
      Tiene ${u.a_cargo} agente(s) a cargo. Si le quitás el rol de jefe, esos agentes quedan sin jefe.</div>` : ''}
    <div class="err" id="u-err"></div></div>
   <div class="modal-f"><button class="btn ghost" data-cerrar>Cancelar</button><button class="btn" id="u-ok">Guardar</button></div>`);
  $$('[data-cerrar]').forEach(b => b.onclick = cerrar);
  $('#u-rol').onchange = e => { $('#u-jef').disabled = e.target.value !== 'agente'; };
  $('#u-jef').disabled = u.rol !== 'agente';
  $('#u-ok').onclick = async () => {
    const btn = $('#u-ok'); btn.disabled = true;
    try {
      const rol = $('#u-rol').value;
      const r = await put(`/edicion/usuarios/${u.id}`, {
        nombre: $('#u-nom').value, usuario: $('#u-usr').value, rol,
        equipo: rol === 'agente' ? $('#u-jef').value : '', sucursal: $('#u-suc').value, linea: $('#u-lin').value,
        email: $('#u-mail').value, tel: $('#u-tel').value, nacimiento: $('#u-nac').value,
        activo: $('#u-act').checked, password: $('#u-pass').value || undefined
      });
      cerrar();
      toast('Empleado actualizado' + (r.liberados ? ` · ${r.liberados} agente(s) quedaron sin jefe` : ''), 'ok');
      vistaEdicion();
    } catch (e) { $('#u-err').textContent = e.message; btn.disabled = false; }
  };
}

/* ================= CLIENTES ================= */
async function clientes() {
  EB().innerHTML = `<div class="card-box">${buscador('Buscar por nombre, teléfono o email…')}<div id="ed-lista">
    <div class="skel"></div><div class="skel"></div></div></div>`;
  conectarBuscador(clientes);
  const cs = await get(`/edicion/contactos?q=${encodeURIComponent(QB)}`);
  const i = $('#ed-q'); if (i && document.activeElement !== i && QB) { i.focus(); i.setSelectionRange(QB.length, QB.length); }
  $('#ed-lista').innerHTML = `<table><thead><tr><th>Cliente</th><th>Teléfono</th><th class="hide-m">Responsable</th>
    <th class="hide-m">Negoc.</th><th class="hide-m">Alta</th><th></th></tr></thead>
   <tbody>${cs.map(c => `<tr><td><b>${esc(c.nombre)}</b></td><td class="mono">${esc(c.tel || '—')}</td>
     <td class="hide-m">${esc(c.responsable || 'Libre')}</td><td class="hide-m">${c.n_negociaciones}</td>
     <td class="hide-m">${fd(c.creado)}</td>
     <td style="text-align:right"><button class="btn ghost sm" data-ec="${c.id}">✏ Editar</button></td></tr>`).join('')
     || `<tr><td colspan="6">${vacio('◎', 'Sin resultados', '')}</td></tr>`}</tbody></table>`;
  $$('[data-ec]').forEach(b => b.onclick = () => modalCliente(cs.find(x => x.id === b.dataset.ec)));
}

function modalCliente(c) {
  const sucs = S.sucursales.map(s => [s.nombre, s.nombre]);
  modal(`<div class="modal-h"><h3>✏ ${esc(c.nombre)}</h3><button class="x" data-cerrar>✕</button></div>
   <div class="modal-b">
    <div class="row"><div class="field"><label>Nombre</label><input id="c-nom" value="${esc(c.nombre)}"></div>
     <div class="field"><label>Teléfono</label><input id="c-tel" value="${esc(c.tel || '')}" inputmode="tel"></div></div>
    <div class="row"><div class="field"><label>Email</label><input id="c-mail" value="${esc(c.email || '')}"></div>
     <div class="field"><label>Documento</label><input id="c-doc" value="${esc(c.doc || '')}"></div>
     <div class="field"><label>Ciudad</label><input id="c-ciu" value="${esc(c.ciudad || '')}"></div></div>
    <div class="field"><label>Dirección</label><input id="c-dir" value="${esc(c.direccion || '')}"></div>
    <div class="row"><div class="field"><label>Sucursal</label><select id="c-suc">${opcionesSelect(sucs, c.sucursal)}</select></div>
     <div class="field"><label>Línea</label><select id="c-lin"><option value="">—</option>
       ${opcionesSelect((S.empresa.lineas || []).map(l => [l, l]), c.linea)}</select></div>
     <div class="field"><label>Responsable</label><select id="c-resp"><option value="">— Libre —</option>
       ${opcionesSelect(usuarios.filter(u => u.activo).map(u => [u.id, `${u.nombre} (${u.rol})`]), c.responsable_id)}</select></div></div>
    <label style="display:flex;gap:8px;align-items:center;font-size:var(--fs-sm);padding:4px 0">
      <input type="checkbox" id="c-mover" checked> Pasar también sus negociaciones abiertas al nuevo responsable</label>
    <label style="display:flex;gap:8px;align-items:center;font-size:var(--fs-sm);padding:4px 0">
      <span class="sw"><input type="checkbox" id="c-frec" ${c.frecuente ? 'checked' : ''}><i></i></span> Cliente frecuente</label>
    <div class="field" style="margin-top:8px"><label>Notas</label><textarea id="c-not" rows="2">${esc(c.notas || '')}</textarea></div>
    <div class="err" id="c-err"></div></div>
   <div class="modal-f"><button class="btn ghost" data-cerrar>Cancelar</button><button class="btn" id="c-ok">Guardar</button></div>`);
  $$('[data-cerrar]').forEach(b => b.onclick = cerrar);
  $('#c-ok').onclick = async () => {
    const btn = $('#c-ok'); btn.disabled = true;
    try {
      await put(`/edicion/contactos/${c.id}`, {
        nombre: $('#c-nom').value, tel: $('#c-tel').value, email: $('#c-mail').value, doc: $('#c-doc').value,
        ciudad: $('#c-ciu').value, direccion: $('#c-dir').value, sucursal: $('#c-suc').value, linea: $('#c-lin').value,
        responsableId: $('#c-resp').value, moverNegociaciones: $('#c-mover').checked,
        frecuente: $('#c-frec').checked, notas: $('#c-not').value
      });
      cerrar(); toast('Cliente actualizado', 'ok'); clientes();
    } catch (e) { $('#c-err').textContent = e.message; btn.disabled = false; }
  };
}

/* ================= NEGOCIACIONES ================= */
async function negociaciones() {
  EB().innerHTML = `<div class="card-box">${buscador('Buscar por cliente, teléfono o título…')}<div id="ed-lista">
    <div class="skel"></div><div class="skel"></div></div></div>`;
  conectarBuscador(negociaciones);
  const ns = await get(`/edicion/negociaciones?q=${encodeURIComponent(QB)}`);
  $('#ed-lista').innerHTML = `<table><thead><tr><th>Creada</th><th>Cliente</th><th>Etapa</th>
    <th class="hide-m">Responsable</th><th class="hide-m">Monto</th><th></th></tr></thead>
   <tbody>${ns.map(n => `<tr><td>${fdate(n.creado)}</td><td><b>${esc(n.cliente)}</b><br>
       <small style="color:var(--muted)">${esc(n.tel || '')}</small></td>
     <td><span class="dot" style="background:${etapa(n.etapa).color}"></span> ${esc(etapa(n.etapa).nombre)}</td>
     <td class="hide-m">${esc(n.agente || 'Sin asignar')}</td>
     <td class="hide-m">${n.monto_cierre ? 'Gs ' + Number(n.monto_cierre).toLocaleString('es-PY') : '—'}</td>
     <td style="text-align:right"><button class="btn ghost sm" data-en="${n.id}">✏ Editar</button></td></tr>`).join('')
     || `<tr><td colspan="6">${vacio('◫', 'Sin resultados', '')}</td></tr>`}</tbody></table>`;
  $$('[data-en]').forEach(b => b.onclick = () => modalNegociacion(ns.find(x => x.id === b.dataset.en)));
}

function modalNegociacion(n) {
  const sucs = S.sucursales.map(s => [s.nombre, s.nombre]);
  const local = d => { const f = new Date(d); return new Date(f - f.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
  modal(`<div class="modal-h"><h3>✏ ${esc(n.cliente)} · ${esc(etapa(n.etapa).nombre)}</h3><button class="x" data-cerrar>✕</button></div>
   <div class="modal-b">
    <div class="field"><label>Título</label><input id="n-tit" value="${esc(n.titulo || '')}"></div>
    <div class="row"><div class="field"><label>Fecha de creación</label><input id="n-cre" type="datetime-local" value="${local(n.creado)}"></div>
     <div class="field"><label>Origen</label><select id="n-ori">${opcionesSelect(ORIGENES.map(o => [o, o]), n.origen)}</select></div></div>
    <div class="row"><div class="field"><label>Responsable</label><select id="n-ag"><option value="">— Sin asignar —</option>
       ${opcionesSelect(usuarios.filter(u => u.activo).map(u => [u.id, `${u.nombre} (${u.rol})`]), n.agente_id)}</select></div>
     <div class="field"><label>Sucursal</label><select id="n-suc">${opcionesSelect(sucs, n.sucursal)}</select></div>
     <div class="field"><label>Línea</label><select id="n-lin"><option value="">—</option>
       ${opcionesSelect((S.empresa.lineas || []).map(l => [l, l]), n.linea)}</select></div></div>
    <div class="row"><div class="field"><label>Valor estimado (Gs)</label><input id="n-val" type="number" inputmode="numeric" value="${n.valor || 0}"></div>
     <div class="field"><label>Monto de cierre (Gs)</label><input id="n-mon" type="number" inputmode="numeric" value="${n.monto_cierre || 0}"></div></div>
    ${n.etapa === 'cerrado' ? `<div class="field"><label>Motivo de cierre</label><input id="n-mot" value="${esc(n.motivo || '')}"></div>` : ''}
    <div style="color:var(--muted);font-size:var(--fs-xs)">La etapa se cambia desde el tablero, para que se apliquen sus reglas.</div>
    <div class="err" id="n-err"></div></div>
   <div class="modal-f"><button class="btn ghost" data-cerrar>Cancelar</button><button class="btn" id="n-ok">Guardar</button></div>`);
  $$('[data-cerrar]').forEach(b => b.onclick = cerrar);
  $('#n-ok').onclick = async () => {
    const btn = $('#n-ok'); btn.disabled = true;
    try {
      await put(`/edicion/negociaciones/${n.id}`, {
        titulo: $('#n-tit').value, creado: $('#n-cre').value ? new Date($('#n-cre').value).toISOString() : undefined,
        origen: $('#n-ori').value, agenteId: $('#n-ag').value, sucursal: $('#n-suc').value, linea: $('#n-lin').value,
        valor: $('#n-val').value, montoCierre: $('#n-mon').value, motivo: $('#n-mot') ? $('#n-mot').value : undefined
      });
      cerrar(); toast('Negociación actualizada', 'ok'); negociaciones();
    } catch (e) { $('#n-err').textContent = e.message; btn.disabled = false; }
  };
}
