/* IMPAR · Campañas masivas por la línea verificada (WhatsApp Cloud API).
   Solo plantillas aprobadas por Meta. El envío lo hace el servidor de a poco, respetando el límite diario. */
import { $, $$, esc, S, get, post, put, del, toast, confirmar, vacio, skeleton, fdate, esAdmin, etapa } from './core.js';
import { leerArchivo, filasDeTexto, tablaDesdeFilas, detectarColumnas, destinosDeTabla } from './planilla-impar.js';

const ESTADOS = {
  borrador: ['Borrador', 't-otro'], enviando: ['Enviando', 't-wa'], pausada: ['Pausada', 't-tel'],
  terminada: ['Terminada', 't-fb'], cancelada: ['Cancelada', 't-otro']
};
const FUENTES = [['nombre', 'Primer nombre del cliente'], ['nombre_completo', 'Nombre completo'], ['columna', 'Columna del listado'], ['fijo', 'Texto fijo']];
const VAR = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;
const n = v => (Number(v) || 0).toLocaleString('es-PY');
const pct = (a, b) => b ? Math.round(a * 100 / b) : 0;
const titulo = t => String(t || '').toLocaleLowerCase('es').replace(/(^|\s)(\p{L})/gu, (m, e, l) => e + l.toLocaleUpperCase('es'));

let pantalla = 'lista', campanaId = null, W = null, sondeo = null, canales = [];
const vista = () => $('#view');
const sigueAqui = () => S.vista === 'camp';

/* ================= Entrada ================= */
export async function vistaCampanas() {
  clearInterval(sondeo);
  if (pantalla === 'nueva' && W) return pintarAsistente();
  if (pantalla === 'detalle' && campanaId) return verDetalle(campanaId);
  return verLista();
}

function cabecera(titulo, sub, acciones = '') {
  return `<div class="cmp-cab"><div><h3>${esc(titulo)}</h3>${sub ? `<p class="sub">${sub}</p>` : ''}</div><div class="cmp-acc">${acciones}</div></div>`;
}

/* ================= Listado ================= */
async function verLista() {
  pantalla = 'lista';
  vista().innerHTML = `<div class="section fx-vista cmp">${skeleton(4)}</div>`;
  let lista;
  try { [canales, lista] = await Promise.all([get('/campanas/canales'), get('/campanas')]); }
  catch (e) { if (sigueAqui()) vista().innerHTML = `<div class="section"><div class="card-box">${vacio('alerta', 'No se pudieron cargar las campañas', e.message)}</div></div>`; return; }
  if (!sigueAqui() || pantalla !== 'lista') return;
  const hayLinea = canales.length > 0;
  vista().innerHTML = `<div class="section fx-vista cmp">
    ${cabecera('Campañas', 'Mensajes masivos con plantillas aprobadas por Meta, desde la línea de WhatsApp verificado.',
      hayLinea ? '<button class="btn" id="cmp-nueva">Nueva campaña</button>' : '')}
    ${hayLinea ? avisoReglas() : ''}
    <div id="cmp-lista">${!hayLinea
      ? `<div class="card-box">${vacio('canal', 'Todavía no hay una línea verificada', 'Las campañas salen solo por WhatsApp Cloud API. Administración la conecta en Administración → Canales.')}</div>`
      : !lista.length
        ? `<div class="card-box">${vacio('mensaje', 'Aún no hay campañas', 'Creá la primera: elegís la plantilla, los clientes y el CRM la envía de a poco.', '<button class="btn sm" id="cmp-nueva2">Crear campaña</button>')}</div>`
        : tablaCampanas(lista)}</div></div>`;
  [$('#cmp-nueva'), $('#cmp-nueva2')].forEach(b => b && (b.onclick = nuevaCampana));
  verListaEventos();
  if (lista.some(c => c.estado === 'enviando')) sondeo = setInterval(() => {
    if (!sigueAqui() || pantalla !== 'lista' || $('#modals .mask')) return clearInterval(sondeo);
    get('/campanas').then(l => { if (sigueAqui() && pantalla === 'lista' && $('#cmp-lista')) { $('#cmp-lista').innerHTML = tablaCampanas(l); verListaEventos(); } }).catch(() => {});
  }, 6000);
}
function verListaEventos() {
  $$('[data-cmp]').forEach(f => {
    f.onclick = () => verDetalle(f.dataset.cmp);
    f.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); verDetalle(f.dataset.cmp); } };
  });
}

function avisoReglas() {
  return `<details class="cmp-reglas card-box"><summary>Antes de enviar: cómo funciona y qué cuesta</summary>
    <ul>
      <li>Solo se pueden usar <b>plantillas aprobadas</b> en el Administrador de WhatsApp de Meta. Se crean y aprueban allí.</li>
      <li>Meta cobra cada mensaje de plantilla de <b>marketing</b>. Hace falta un método de pago cargado en la cuenta de mensajes.</li>
      <li>La línea verificada no es «a prueba de bloqueos»: si muchos clientes bloquean o reportan, Meta baja la calidad del número y limita los envíos.</li>
      <li>Meta fija un tope de destinatarios por día (empieza en 250 y sube con el buen uso). El CRM respeta el límite que pongas y sigue al día siguiente.</li>
      <li>Si un cliente responde <b>BAJA</b>, el CRM no le vuelve a mandar campañas. Sus respuestas entran como conversación normal.</li>
    </ul></details>`;
}

function barra(c) {
  const total = c.total || 0;
  return `<div class="cmp-barra" role="progressbar" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${c.enviados}" aria-label="Enviados ${c.enviados} de ${total}">
    <i class="b-env" style="width:${pct(c.enviados, total)}%"></i><i class="b-fal" style="width:${pct(c.fallidos + c.omitidos, total)}%"></i></div>`;
}

function tablaCampanas(lista) {
  return `<div class="card-box cmp-tabla"><table><thead><tr><th>Campaña</th><th>Estado</th><th>Avance</th>
    <th class="hide-m num">Entregados</th><th class="hide-m num">Leídos</th><th class="hide-m num">Respondieron</th><th class="hide-m">Creada</th></tr></thead><tbody>
    ${lista.map(c => { const [et, cl] = ESTADOS[c.estado] || [c.estado, 't-otro']; return `
      <tr data-cmp="${esc(c.id)}" tabindex="0">
        <td><b>${esc(c.nombre)}</b><small>${esc(c.plantilla?.nombre || '')} · ${esc(c.canal_nombre || 'línea eliminada')}</small></td>
        <td><span class="tag ${cl}">${et}</span>${c.error && c.estado === 'enviando' ? '<small class="cmp-espera">En espera</small>' : ''}</td>
        <td class="cmp-av">${barra(c)}<small>${n(c.enviados)} de ${n(c.total)}${c.fallidos ? ` · ${n(c.fallidos)} con error` : ''}</small></td>
        <td class="hide-m num">${n(c.entregados)}</td><td class="hide-m num">${n(c.leidos)}</td><td class="hide-m num">${n(c.respondieron)}</td>
        <td class="hide-m"><small>${esc(fdate(c.creado))}<br>${esc(c.creado_por_nombre || '')}</small></td></tr>`; }).join('')}
    </tbody></table></div>`;
}

/* ================= Detalle ================= */
async function verDetalle(id) {
  clearInterval(sondeo);
  pantalla = 'detalle'; campanaId = id;
  if (!$('#cmp-detalle')) vista().innerHTML = `<div class="section fx-vista cmp">${skeleton(5)}</div>`;
  let c;
  try { c = await get('/campanas/' + encodeURIComponent(id)); }
  catch (e) { toast(e.message, 'bad', 'Campañas'); pantalla = 'lista'; return verLista(); }
  if (!sigueAqui() || pantalla !== 'detalle' || campanaId !== id) return;
  const [et, cl] = ESTADOS[c.estado] || [c.estado, 't-otro'];
  const btn = (acc, txt, tipo = 'ghost') => `<button class="btn ${tipo} sm" data-acc="${acc}">${txt}</button>`;
  const acciones = [
    '<button class="btn ghost sm" id="cmp-volver">Volver a campañas</button>',
    c.estado === 'borrador' && btn('iniciar', 'Empezar envío', ''),
    c.estado === 'enviando' && btn('pausar', 'Pausar'),
    c.estado === 'pausada' && btn('reanudar', 'Reanudar envío', ''),
    ['borrador', 'enviando', 'pausada'].includes(c.estado) && btn('cancelar', 'Cancelar campaña', 'danger'),
    c.estado === 'borrador' && btn('borrar', 'Borrar', 'danger')
  ].filter(Boolean).join('');
  const limite = c.limite_diario || 250;
  vista().innerHTML = `<div class="section fx-vista cmp" id="cmp-detalle">
    ${cabecera(c.nombre, `<span class="tag ${cl}">${et}</span> Plantilla <b>${esc(c.plantilla?.nombre || '')}</b> · ${esc(c.canal_nombre || 'línea eliminada')} · creada ${esc(fdate(c.creado))}${c.creado_por_nombre ? ' por ' + esc(c.creado_por_nombre) : ''}`, acciones)}
    ${c.error ? `<div class="card-box cmp-error ${c.estado === 'pausada' ? 'grave' : ''}" role="status">${esc(c.error)}</div>` : ''}
    <div class="card-box cmp-progreso">
      <div class="cmp-prog-cab"><b>${n(c.enviados)} de ${n(c.total)} enviados</b><span class="sub">${c.pendientes ? `${n(c.pendientes)} pendientes · ` : ''}la línea mandó ${n(c.usados24h)} de ${n(limite)} en las últimas 24 h</span></div>
      ${barra(c)}
    </div>
    <div class="grid g4 cmp-kpis">
      <div class="kpi"><span>Entregados</span><b>${n(c.entregados)}</b></div>
      <div class="kpi"><span>Leídos</span><b>${n(c.leidos)}</b></div>
      <div class="kpi"><span>Respondieron</span><b>${n(c.respondieron)}</b></div>
      <div class="kpi"><span>Con error u omitidos</span><b>${n(c.fallidos + c.omitidos)}</b></div>
    </div>
    <div class="cmp-dos">
      <div class="card-box"><h3>Mensaje</h3>${burbuja(c.plantilla, c.variables, { nombre: 'María González', datos: {} })}</div>
      <div class="card-box"><h3>Errores y omitidos</h3>${c.problemas.length
        ? `<div class="cmp-scroll"><table><thead><tr><th>Cliente</th><th>Motivo</th></tr></thead><tbody>${c.problemas.map(p =>
            `<tr><td><b>${esc(p.nombre || 'Sin nombre')}</b><small>${esc(p.telefono)}</small></td><td>${esc(p.error || (p.estado === 'omitido' ? 'Omitido' : 'Error'))}</td></tr>`).join('')}</tbody></table></div>`
        : `<p class="sub">Ningún envío falló.</p>`}</div>
    </div></div>`;
  $('#cmp-volver').onclick = () => { campanaId = null; verLista(); };
  $$('[data-acc]').forEach(b => b.onclick = () => accion(c, b.dataset.acc, b));
  if (['enviando'].includes(c.estado)) sondeo = setInterval(() => {
    if (!sigueAqui() || pantalla !== 'detalle' || campanaId !== id || $('#modals .mask')) return clearInterval(sondeo);
    verDetalle(id);
  }, 5000);
}

async function accion(c, acc, boton) {
  if (acc === 'iniciar' && !await confirmar('Empezar envío', `Se enviará la plantilla a <b>${n(c.pendientes)}</b> clientes, como máximo ${n(c.limite_diario)} por día. Meta cobra cada mensaje de marketing.`, 'Empezar envío', false)) return;
  if (acc === 'cancelar' && !await confirmar('Cancelar campaña', `Los ${n(c.pendientes)} mensajes que faltan no se enviarán. Lo ya enviado no se puede deshacer.`, 'Cancelar campaña')) return;
  if (acc === 'borrar' && !await confirmar('Borrar campaña', `Se borra «${esc(c.nombre)}» con su lista de destinatarios. No se envió ningún mensaje.`, 'Borrar campaña')) return;
  boton.disabled = true;
  try {
    if (acc === 'borrar') { await del('/campanas/' + c.id); toast('Campaña borrada', 'ok', 'Campañas'); campanaId = null; return verLista(); }
    await post(`/campanas/${c.id}/${acc}`, {});
    toast({ iniciar: 'Envío iniciado', pausar: 'Campaña pausada', reanudar: 'Envío reanudado', cancelar: 'Campaña cancelada' }[acc], 'ok', 'Campañas');
    verDetalle(c.id);
  } catch (e) { boton.disabled = false; toast(e.message, 'bad', 'Campañas'); }
}

/* ================= Vista previa del mensaje ================= */
function valorLocal(def = {}, d = {}) {
  const limpio = v => String(v ?? '').replace(/\s+/g, ' ').trim();
  let v = '';
  if (def.fuente === 'nombre') { const p = limpio(d.nombre).split(' ')[0] || ''; v = p ? p[0].toLocaleUpperCase('es') + p.slice(1).toLocaleLowerCase('es') : ''; }
  else if (def.fuente === 'nombre_completo') v = limpio(d.nombre);
  else if (def.fuente === 'columna') v = limpio(d.datos?.[def.columna]);
  else if (def.fuente === 'fijo') v = limpio(def.valor);
  return v || limpio(def.respaldo) || (def.fuente?.startsWith('nombre') ? 'cliente' : '');
}
function rellenar(texto, defs, d) {
  return esc(texto || '').replace(VAR, (m, k) => {
    const v = valorLocal(defs?.[k], d);
    return v ? `<mark>${esc(v)}</mark>` : `<mark class="falta">{{${esc(k)}}}</mark>`;
  }).replace(/\*([^*\n]+)\*/g, '<b>$1</b>').replace(/_([^_\n]+)_/g, '<i>$1</i>').replace(/\n/g, '<br>');
}
function burbuja(p, vars = {}, d = {}) {
  if (!p?.cuerpo) return '<p class="sub">Sin plantilla.</p>';
  const enc = p.encabezado;
  const media = { IMAGE: 'Imagen', VIDEO: 'Video', DOCUMENT: 'Documento' }[enc?.formato];
  return `<div class="cmp-burbuja">
    ${media ? `<div class="cmp-media">${media}${vars.media ? '' : ' · falta el enlace'}</div>` : ''}
    ${enc?.formato === 'TEXT' ? `<b class="cmp-enc">${rellenar(enc.texto, vars.encabezado, d)}</b>` : ''}
    <div>${rellenar(p.cuerpo.texto, vars.cuerpo, d)}</div>
    ${p.pie ? `<small class="cmp-pie">${esc(p.pie)}</small>` : ''}
    ${(p.botones || []).length ? `<div class="cmp-botones">${p.botones.map(b => `<span>${esc(b.texto)}</span>`).join('')}</div>` : ''}
  </div>`;
}

/* ================= Asistente: nueva campaña ================= */
function nuevaCampana() {
  W = {
    paso: 1, nombre: '', canal: canales.length === 1 ? canales[0].id : '', plantillas: null, plantilla: null,
    variables: { encabezado: {}, cuerpo: {}, media: '' },
    origen: 'sistema', sel: new Map(), todos: false, filtros: { texto: '', sucursal: '', ciudad: '', etapa: '' },
    pagina: 0, contactos: null, opciones: null,
    tabla: null, colTel: -1, colNom: -1, lista: [], resumenLista: null, limite: 250
  };
  pantalla = 'nueva';
  pintarAsistente();
}

const PASOS = ['Plantilla', 'Destinatarios', 'Mensaje', 'Revisar y enviar'];
function pintarAsistente() {
  clearInterval(sondeo);
  vista().innerHTML = `<div class="section fx-vista cmp">
    ${cabecera('Nueva campaña', '', '<button class="btn ghost sm" id="cmp-salir">Descartar</button>')}
    <ol class="cmp-pasos">${PASOS.map((t, i) => `<li class="${W.paso === i + 1 ? 'act' : W.paso > i + 1 ? 'ok' : ''}" ${W.paso === i + 1 ? 'aria-current="step"' : ''}><span>${i + 1}</span>${t}</li>`).join('')}</ol>
    <div id="cmp-paso"></div>
    <div class="cmp-pie-asis"><span id="cmp-estado" class="sub"></span>
      <div>${W.paso > 1 ? '<button class="btn ghost" id="cmp-atras">Atrás</button>' : ''}
      ${W.paso < 4 ? '<button class="btn" id="cmp-sig">Continuar</button>' : ''}</div></div></div>`;
  $('#cmp-salir').onclick = async () => {
    if (W.plantilla || W.sel.size || W.lista.length) { if (!await confirmar('Descartar campaña', 'Se pierde lo que cargaste en este asistente.', 'Descartar')) return; }
    W = null; verLista();
  };
  if ($('#cmp-atras')) $('#cmp-atras').onclick = () => { W.paso--; pintarAsistente(); };
  if ($('#cmp-sig')) $('#cmp-sig').onclick = () => { const err = validarPaso(); if (err) return toast(err, 'warn', 'Campañas'); W.paso++; pintarAsistente(); };
  ({ 1: pasoPlantilla, 2: pasoDestinos, 3: pasoMensaje, 4: pasoRevisar })[W.paso]();
}
const P = () => $('#cmp-paso');
const estado = t => { if ($('#cmp-estado')) $('#cmp-estado').innerHTML = t; };

function validarPaso() {
  if (W.paso === 1) {
    if (!W.nombre.trim()) return 'Poné un nombre a la campaña.';
    if (!W.canal) return 'Elegí la línea verificada.';
    if (!W.plantilla) return 'Elegí una plantilla aprobada.';
  }
  if (W.paso === 2 && !totalDestinos()) return 'Elegí clientes del sistema o cargá un listado.';
  if (W.paso === 3) { const f = faltan(); if (f.length) return 'Completá: ' + f.join(', ') + '.'; }
  return '';
}

/* ---------- Paso 1: línea y plantilla ---------- */
async function pasoPlantilla() {
  P().innerHTML = `<div class="card-box">
    <div class="grid g2">
      <div class="field"><label for="cmp-nom">Nombre de la campaña (solo lo ve el equipo)</label>
        <input id="cmp-nom" maxlength="120" value="${esc(W.nombre)}" placeholder="Ej.: Vuelta a clases"></div>
      <div class="field"><label for="cmp-canal">Línea verificada que envía</label>
        <select id="cmp-canal">${canales.length > 1 ? '<option value="">Elegí una línea…</option>' : ''}${canales.map(c =>
          `<option value="${esc(c.id)}" ${W.canal === c.id ? 'selected' : ''}>${esc(c.nombre)}${c.numero ? ' · ' + esc(c.numero) : ''}${c.activo ? '' : ' (apagada)'}</option>`).join('')}</select></div>
    </div>
    <h3>Plantilla aprobada</h3><div id="cmp-plantillas">${W.canal ? skeleton(3) : '<p class="sub">Elegí la línea para ver sus plantillas.</p>'}</div></div>`;
  $('#cmp-nom').oninput = e => { W.nombre = e.target.value; };
  $('#cmp-canal').onchange = e => { W.canal = e.target.value; W.plantillas = null; W.plantilla = null; pasoPlantilla(); };
  $('#cmp-nom').focus();
  if (!W.canal) return;
  const canal = canales.find(c => c.id === W.canal);
  if (canal && !canal.activo) estado('La línea está apagada: la campaña queda en pausa hasta que la enciendan.');
  if (!W.plantillas) {
    try { W.plantillas = await get('/campanas/plantillas?canal=' + encodeURIComponent(W.canal)); }
    catch (e) { if ($('#cmp-plantillas')) $('#cmp-plantillas').innerHTML = vacio('alerta', 'No se pudieron leer las plantillas de Meta', e.message); return; }
  }
  if (!$('#cmp-plantillas') || W.paso !== 1) return;
  if (!W.plantillas.length) {
    $('#cmp-plantillas').innerHTML = vacio('mensaje', 'Esta línea no tiene plantillas aprobadas', 'Creá una en el Administrador de WhatsApp de Meta (cuenta de mensajes de IMPAR CRM). Cuando Meta la apruebe, aparece acá.');
    return;
  }
  $('#cmp-plantillas').innerHTML = `<div class="cmp-plantillas" role="radiogroup" aria-label="Plantillas aprobadas">${W.plantillas.map((p, i) => {
    const elegida = W.plantilla?.nombre === p.nombre && W.plantilla?.idioma === p.idioma;
    return `<button type="button" role="radio" aria-checked="${elegida}" class="cmp-pl ${elegida ? 'sel' : ''}" data-pl="${i}" ${p.soportada ? '' : 'disabled'}>
      <span class="cmp-pl-cab"><b>${esc(p.nombre)}</b><span class="tag ${p.categoria === 'MARKETING' ? 't-tel' : 't-otro'}">${esc({ MARKETING: 'Marketing', UTILITY: 'Utilidad', AUTHENTICATION: 'Autenticación' }[p.categoria] || p.categoria)}</span><small>${esc(p.idioma)}</small></span>
      <span class="cmp-pl-txt">${esc(p.cuerpo.texto).slice(0, 220)}${p.cuerpo.texto.length > 220 ? '…' : ''}</span>
      ${p.soportada ? '' : `<small class="cmp-pl-no">${esc(p.motivo)}</small>`}</button>`;
  }).join('')}</div>`;
  $$('[data-pl]').forEach(b => b.onclick = () => {
    const p = W.plantillas[Number(b.dataset.pl)];
    if (W.plantilla?.nombre !== p.nombre || W.plantilla?.idioma !== p.idioma) W.variables = variablesIniciales(p);
    W.plantilla = p;
    $$('[data-pl]').forEach(x => { x.classList.toggle('sel', x === b); x.setAttribute('aria-checked', String(x === b)); });
  });
}

function variablesIniciales(p) {
  const def = k => /nombre|name|cliente/i.test(k) || k === '1' ? { fuente: 'nombre', respaldo: 'cliente' } : { fuente: 'fijo', valor: '' };
  const v = { encabezado: {}, cuerpo: {}, media: '' };
  if (p.encabezado?.formato === 'TEXT') p.encabezado.variables.forEach(k => v.encabezado[k] = def(k));
  p.cuerpo.variables.forEach(k => v.cuerpo[k] = def(k));
  return v;
}

/* ---------- Paso 2: destinatarios ---------- */
const totalSistema = () => W.todos ? (W.contactos?.total || 0) : W.sel.size;
const totalDestinos = () => totalSistema() + W.lista.length;
function resumenDestinos() {
  const s = totalSistema(), l = W.lista.length;
  estado(s || l ? `<b>${n(s + l)}</b> destinatarios: ${n(s)} del sistema${l ? ` y ${n(l)} del listado` : ''}. Los números repetidos se envían una sola vez.` : 'Todavía no hay destinatarios.');
}

function pasoDestinos() {
  P().innerHTML = `<div class="card-box">
    <div class="cmp-tabs" role="tablist">
      <button role="tab" class="${W.origen === 'sistema' ? 'act' : ''}" aria-selected="${W.origen === 'sistema'}" data-org="sistema">Clientes del sistema ${W.sel.size || W.todos ? `<span class="count">${n(totalSistema())}</span>` : ''}</button>
      <button role="tab" class="${W.origen === 'lista' ? 'act' : ''}" aria-selected="${W.origen === 'lista'}" data-org="lista">Cargar listado ${W.lista.length ? `<span class="count">${n(W.lista.length)}</span>` : ''}</button>
    </div><div id="cmp-org"></div></div>`;
  $$('[data-org]').forEach(b => b.onclick = () => { W.origen = b.dataset.org; pasoDestinos(); });
  resumenDestinos();
  W.origen === 'sistema' ? origenSistema() : origenLista();
}

async function origenSistema() {
  const f = W.filtros, o = W.opciones;
  const sel = (id, etiqueta, lista, valor, nombre = v => v) => `<div class="field"><label for="${id}">${etiqueta}</label><select id="${id}"><option value="">Todas</option>${(lista || []).map(v => `<option value="${esc(v)}" ${v === valor ? 'selected' : ''}>${esc(nombre(v))}</option>`).join('')}</select></div>`;
  $('#cmp-org').innerHTML = `<div class="cmp-filtros">
      <div class="field"><label for="cmp-q">Buscar</label><input id="cmp-q" type="search" value="${esc(f.texto)}" placeholder="Nombre o teléfono"></div>
      ${sel('cmp-suc', 'Sucursal', o?.sucursales, f.sucursal)}${sel('cmp-ciu', 'Ciudad', o?.ciudades, f.ciudad)}${sel('cmp-et', 'Etapa', o?.etapas, f.etapa, v => etapa(v).nombre)}
    </div>
    <label class="cmp-todos"><input type="checkbox" id="cmp-todos" ${W.todos ? 'checked' : ''}> <span id="cmp-todos-txt">Enviar a todos los que coinciden con el filtro</span></label>
    <div id="cmp-contactos">${skeleton(4)}</div>`;
  if (!o) get('/campanas/filtros').then(r => { W.opciones = r; if (W.paso === 2 && W.origen === 'sistema') origenSistema(); }).catch(() => {});
  let t;
  const recargar = () => { W.pagina = 0; if (W.todos) { W.todos = false; $('#cmp-todos').checked = false; } cargarContactos(); };
  $('#cmp-q').oninput = e => { f.texto = e.target.value; clearTimeout(t); t = setTimeout(recargar, 350); };
  [['cmp-suc', 'sucursal'], ['cmp-ciu', 'ciudad'], ['cmp-et', 'etapa']].forEach(([id, k]) => $('#' + id).onchange = e => { f[k] = e.target.value; recargar(); });
  $('#cmp-todos').onchange = e => { W.todos = e.target.checked; if (W.todos) W.sel.clear(); pintarContactos(); resumenDestinos(); };
  cargarContactos();
}

async function cargarContactos() {
  const f = W.filtros, qs = new URLSearchParams({ ...f, pagina: W.pagina });
  try { W.contactos = await get('/campanas/contactos?' + qs); }
  catch (e) { if ($('#cmp-contactos')) $('#cmp-contactos').innerHTML = vacio('alerta', 'No se pudieron cargar los clientes', e.message); return; }
  if (W.paso === 2 && W.origen === 'sistema') { pintarContactos(); resumenDestinos(); }
}

function pintarContactos() {
  const caja = $('#cmp-contactos'), r = W.contactos;
  if (!caja || !r) return;
  $('#cmp-todos-txt').textContent = `Enviar a los ${n(r.total)} clientes que coinciden con el filtro`;
  if (!r.contactos.length) { caja.innerHTML = vacio('buscar', 'Ningún cliente coincide', 'Probá con otro nombre o quitá algún filtro.'); return; }
  const elegibles = r.contactos.filter(c => !c.baja);
  const todosPagina = elegibles.length && elegibles.every(c => W.sel.has(c.id));
  const ultima = (W.pagina + 1) * 100 >= r.total;
  caja.innerHTML = `<div class="cmp-scroll alto"><table><thead><tr>
      <th><input type="checkbox" id="cmp-pag" ${todosPagina || W.todos ? 'checked' : ''} ${W.todos ? 'disabled' : ''} aria-label="Elegir los clientes de esta página"></th>
      <th>Cliente</th><th>Teléfono</th><th class="hide-m">Sucursal</th><th class="hide-m">Ciudad</th></tr></thead><tbody>
      ${r.contactos.map(c => `<tr class="${c.baja ? 'cmp-baja' : ''}"><td><input type="checkbox" data-ct="${esc(c.id)}" ${W.todos ? 'checked disabled' : W.sel.has(c.id) ? 'checked' : ''} ${c.baja ? 'disabled' : ''} aria-label="Elegir ${esc(c.nombre)}"></td>
        <td><b>${esc(c.nombre || 'Sin nombre')}</b>${c.baja ? '<small>Pidió no recibir campañas</small>' : ''}</td><td>${esc(c.tel)}</td><td class="hide-m">${esc(c.sucursal || '—')}</td><td class="hide-m">${esc(c.ciudad || '—')}</td></tr>`).join('')}
    </tbody></table></div>
    <div class="cmp-pag"><span class="sub">${n(W.pagina * 100 + 1)}–${n(Math.min(r.total, (W.pagina + 1) * 100))} de ${n(r.total)}</span>
      <span><button class="btn ghost sm" id="cmp-ant" ${W.pagina ? '' : 'disabled'}>Anterior</button> <button class="btn ghost sm" id="cmp-sigp" ${ultima ? 'disabled' : ''}>Siguiente</button></span></div>`;
  $$('[data-ct]').forEach(ch => ch.onchange = () => {
    const c = r.contactos.find(x => x.id === ch.dataset.ct);
    ch.checked ? W.sel.set(c.id, { nombre: c.nombre, datos: {} }) : W.sel.delete(c.id);
    resumenDestinos(); $('#cmp-pag').checked = elegibles.every(x => W.sel.has(x.id));
  });
  $('#cmp-pag').onchange = e => { elegibles.forEach(c => e.target.checked ? W.sel.set(c.id, { nombre: c.nombre, datos: {} }) : W.sel.delete(c.id)); pintarContactos(); resumenDestinos(); };
  $('#cmp-ant').onclick = () => { W.pagina--; cargarContactos(); };
  $('#cmp-sigp').onclick = () => { W.pagina++; cargarContactos(); };
}

function origenLista() {
  $('#cmp-org').innerHTML = `<div class="cmp-carga">
      <div class="field"><label for="cmp-arch">Archivo Excel (.xlsx) o CSV</label><input type="file" id="cmp-arch" accept=".xlsx,.csv,.txt,text/csv"></div>
      <div class="field"><label for="cmp-pega">O pegá la lista (copiada de Excel: una fila por cliente)</label>
        <textarea id="cmp-pega" rows="4" placeholder="0981 123 456	María López&#10;0982 654 321	Juan Pérez"></textarea>
        <button class="btn ghost sm" id="cmp-leer">Leer lista pegada</button></div>
    </div>
    <p class="sub">La primera fila puede tener los títulos de las columnas. Las columnas extra (ciudad, monto, etc.) se pueden usar en el mensaje.</p>
    <div id="cmp-mapa"></div>`;
  $('#cmp-arch').onchange = async e => {
    const a = e.target.files[0]; if (!a) return;
    try { usarTabla(await leerArchivo(a), a.name); } catch (err) { toast(err.message, 'bad', 'Listado'); }
    e.target.value = '';
  };
  $('#cmp-leer').onclick = () => {
    const t = $('#cmp-pega').value;
    if (!t.trim()) return toast('Pegá al menos un número.', 'warn', 'Listado');
    usarTabla(tablaDesdeFilas(filasDeTexto(t)), 'lista pegada');
  };
  if (W.tabla) pintarMapa();
}

function usarTabla(tabla, origen) {
  if (!tabla.filas.length) return toast('No se encontraron filas con datos.', 'warn', 'Listado');
  const c = detectarColumnas(tabla);
  W.tabla = { ...tabla, origen }; W.colTel = c.tel; W.colNom = c.nom;
  if (tabla.recortado) toast('El listado tenía más de 20.000 filas: se tomaron las primeras 20.000.', 'warn', 'Listado');
  aplicarMapa(); pintarMapa();
}
function aplicarMapa() {
  if (W.colTel < 0) { W.lista = []; W.resumenLista = null; return; }
  const r = destinosDeTabla(W.tabla, W.colTel, W.colNom);
  W.lista = r.destinos; W.resumenLista = r;
}
function pintarMapa() {
  const t = W.tabla, caja = $('#cmp-mapa');
  if (!t || !caja) return;
  const opc = (valor, vacio) => `${vacio ? '<option value="-1">Sin nombre</option>' : ''}${t.cabeceras.map((c, i) => `<option value="${i}" ${i === valor ? 'selected' : ''}>${esc(c)}</option>`).join('')}`;
  const r = W.resumenLista;
  caja.innerHTML = `<div class="cmp-mapa">
    <div class="cmp-mapa-cab"><b>${esc(t.origen)}</b> · ${n(t.filas.length)} filas <button class="btn ghost sm" id="cmp-quitar">Quitar listado</button></div>
    <div class="grid g2">
      <div class="field"><label for="cmp-ctel">Columna del teléfono</label><select id="cmp-ctel">${W.colTel < 0 ? '<option value="-1">Elegí la columna…</option>' : ''}${opc(W.colTel)}</select></div>
      <div class="field"><label for="cmp-cnom">Columna del nombre</label><select id="cmp-cnom">${opc(W.colNom, true)}</select></div>
    </div>
    ${r ? `<p class="sub">${n(r.destinos.length)} clientes listos${r.repetidos ? ` · ${n(r.repetidos)} repetidos quitados` : ''}${r.sinNumero ? ` · ${n(r.sinNumero)} filas sin número` : ''}.</p>` : ''}
    <div class="cmp-scroll"><table><thead><tr>${t.cabeceras.map((c, i) => `<th class="${i === W.colTel ? 'col-tel' : i === W.colNom ? 'col-nom' : ''}">${esc(c)}</th>`).join('')}</tr></thead>
      <tbody>${t.filas.slice(0, 5).map(f => `<tr>${f.map(v => `<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></div>`;
  $('#cmp-ctel').onchange = e => { W.colTel = Number(e.target.value); if (W.colNom === W.colTel) W.colNom = -1; aplicarMapa(); pintarMapa(); pasoDestinosContadores(); };
  $('#cmp-cnom').onchange = e => { W.colNom = Number(e.target.value); aplicarMapa(); pintarMapa(); };
  $('#cmp-quitar').onclick = () => { W.tabla = null; W.lista = []; W.resumenLista = null; origenLista(); pasoDestinosContadores(); };
  pasoDestinosContadores();
}
function pasoDestinosContadores() {
  resumenDestinos();
  const tab = $('[data-org="lista"]');
  if (tab) tab.innerHTML = `Cargar listado ${W.lista.length ? `<span class="count">${n(W.lista.length)}</span>` : ''}`;
}

/* ---------- Paso 3: variables del mensaje ---------- */
const columnasLista = () => W.tabla ? W.tabla.cabeceras.filter((_, i) => i !== W.colTel && i !== W.colNom) : [];
function faltan() {
  const p = W.plantilla, v = W.variables, f = [];
  const rev = (lista, defs, lugar) => lista.forEach(k => {
    const d = defs[k];
    if (!d?.fuente) f.push(`${lugar} {{${k}}}`);
    else if (d.fuente === 'fijo' && !String(d.valor || '').trim()) f.push(`${lugar} {{${k}}}`);
    else if (d.fuente === 'columna' && !columnasLista().includes(d.columna)) f.push(`${lugar} {{${k}}} (columna)`);
  });
  if (p.encabezado?.formato === 'TEXT') rev(p.encabezado.variables, v.encabezado, 'encabezado');
  rev(p.cuerpo.variables, v.cuerpo, 'mensaje');
  if (['IMAGE', 'VIDEO', 'DOCUMENT'].includes(p.encabezado?.formato) && !/^https:\/\/\S+$/.test(v.media || '')) f.push('enlace del archivo');
  return f;
}
function ejemplo() {
  if (W.lista.length) return W.lista[0];
  const primero = [...W.sel.values()][0] || W.contactos?.contactos?.[0];
  return primero ? { nombre: primero.nombre, datos: {} } : { nombre: 'María González', datos: {} };
}

function pasoMensaje() {
  const p = W.plantilla, v = W.variables, cols = columnasLista();
  const filas = [];
  if (p.encabezado?.formato === 'TEXT') p.encabezado.variables.forEach(k => filas.push(['encabezado', k]));
  p.cuerpo.variables.forEach(k => filas.push(['cuerpo', k]));
  const media = ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(p.encabezado?.formato);
  P().innerHTML = `<div class="cmp-dos">
    <div class="card-box"><h3>Qué va en cada espacio</h3>
      ${!filas.length && !media ? '<p class="sub">Esta plantilla no tiene espacios para completar: todos reciben el mismo texto.</p>' : ''}
      ${media ? `<div class="field"><label for="cmp-media">Enlace público (https) ${({ IMAGE: 'de la imagen', VIDEO: 'del video', DOCUMENT: 'del documento' })[p.encabezado.formato]}</label>
        <input id="cmp-media" type="url" value="${esc(v.media)}" placeholder="https://…"><small class="sub">Meta lo descarga una vez por envío. Tiene que abrir sin iniciar sesión.</small></div>` : ''}
      ${filas.map(([lugar, k]) => { const d = v[lugar][k] || {}; const id = `cv-${lugar}-${k}`; return `
        <fieldset class="cmp-var" data-lugar="${lugar}" data-k="${esc(k)}"><legend>${lugar === 'encabezado' ? 'Encabezado ' : ''}<code>{{${esc(k)}}}</code></legend>
          <div class="grid g2">
            <div class="field"><label for="${id}">Completar con</label><select id="${id}" data-f="fuente">${FUENTES.filter(([f]) => f !== 'columna' || cols.length).map(([f, t]) => `<option value="${f}" ${d.fuente === f ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
            ${d.fuente === 'fijo' ? `<div class="field"><label for="${id}-v">Texto</label><input id="${id}-v" data-f="valor" value="${esc(d.valor || '')}" maxlength="300"></div>`
              : d.fuente === 'columna' ? `<div class="field"><label for="${id}-c">Columna</label><select id="${id}-c" data-f="columna"><option value="">Elegí…</option>${cols.map(c => `<option ${c === d.columna ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div>`
              : `<div class="field"><label for="${id}-r">Si no hay nombre, usar</label><input id="${id}-r" data-f="respaldo" value="${esc(d.respaldo ?? 'cliente')}" maxlength="60"></div>`}
          </div>
          ${d.fuente === 'columna' ? `<div class="field"><label for="${id}-r">Si la celda está vacía, usar</label><input id="${id}-r" data-f="respaldo" value="${esc(d.respaldo || '')}" maxlength="60" placeholder="Opcional"></div>` : ''}
        </fieldset>`; }).join('')}
    </div>
    <div class="card-box cmp-previa"><h3>Así lo recibe ${esc(titulo(ejemplo().nombre) || 'el cliente')}</h3><div id="cmp-burbuja"></div>
      ${W.sel.size && cols.length ? '<p class="sub">Los clientes del sistema no tienen las columnas del listado: para ellos se usa el texto de respaldo.</p>' : ''}</div></div>`;
  const repintar = () => { $('#cmp-burbuja').innerHTML = burbuja(p, v, ejemplo()); const f = faltan(); estado(f.length ? `Falta completar: ${esc(f.join(', '))}` : 'Mensaje completo.'); };
  $$('.cmp-var').forEach(fs => {
    const lugar = fs.dataset.lugar, k = fs.dataset.k;
    $$('[data-f]', fs).forEach(el => {
      const evento = el.tagName === 'SELECT' ? 'onchange' : 'oninput';
      el[evento] = () => {
        const d = v[lugar][k] ||= {};
        d[el.dataset.f] = el.value;
        if (el.dataset.f === 'fuente') { v[lugar][k] = { fuente: el.value, respaldo: el.value.startsWith('nombre') ? 'cliente' : '' }; pasoMensaje(); return; }
        repintar();
      };
    });
  });
  if ($('#cmp-media')) $('#cmp-media').oninput = e => { v.media = e.target.value.trim(); repintar(); };
  repintar();
}

/* ---------- Paso 4: revisar y enviar ---------- */
function pasoRevisar() {
  const canal = canales.find(c => c.id === W.canal) || {};
  const total = totalDestinos();
  const dias = Math.max(1, Math.ceil(total / Math.max(1, W.limite)));
  P().innerHTML = `<div class="cmp-dos">
    <div class="card-box"><h3>Resumen</h3>
      <dl class="cmp-dl">
        <dt>Campaña</dt><dd>${esc(W.nombre)}</dd>
        <dt>Línea</dt><dd>${esc(canal.nombre || '')}${canal.numero ? ' · ' + esc(canal.numero) : ''}</dd>
        <dt>Plantilla</dt><dd>${esc(W.plantilla.nombre)} (${esc(W.plantilla.idioma)})</dd>
        <dt>Destinatarios</dt><dd>${n(total)} (${n(totalSistema())} del sistema${W.lista.length ? `, ${n(W.lista.length)} del listado` : ''})</dd>
      </dl>
      <div class="field"><label for="cmp-lim">Máximo de mensajes por día</label>
        <input id="cmp-lim" type="number" min="1" max="100000" step="1" value="${W.limite}">
        <small class="sub"><span id="cmp-dias">${dias > 1 ? `Se completa en unos ${dias} días.` : 'Se envía en el día.'}</span> La línea ya mandó ${n(canal.usados24h)} en las últimas 24 h. Si superás el tope que Meta le asignó al número, Meta rechaza los envíos.</small></div>
      <p class="sub">Los números que pidieron BAJA y los inválidos se omiten automáticamente.</p>
      <div class="cmp-final">
        <button class="btn ghost" id="cmp-borrador">Guardar sin enviar</button>
        <button class="btn" id="cmp-enviar">Crear y empezar envío</button>
      </div></div>
    <div class="card-box cmp-previa"><h3>Mensaje</h3>${burbuja(W.plantilla, W.variables, ejemplo())}</div></div>`;
  estado('Revisá todo antes de enviar: lo enviado no se puede deshacer.');
  $('#cmp-lim').oninput = e => {
    W.limite = Math.min(100000, Math.max(1, Math.round(Number(e.target.value) || 1)));
    const d = Math.max(1, Math.ceil(total / W.limite));
    $('#cmp-dias').textContent = d > 1 ? `Se completa en unos ${d} días.` : 'Se envía en el día.';
  };
  $('#cmp-borrador').onclick = e => crear(false, e.target);
  $('#cmp-enviar').onclick = e => crear(true, e.target);
}

async function crear(empezar, boton) {
  const total = totalDestinos();
  if (empezar && !await confirmar('Crear y empezar envío', `Se enviará «${esc(W.plantilla.nombre)}» a ${n(total)} destinatarios, como máximo ${n(W.limite)} por día. Meta cobra cada mensaje de marketing y lo enviado no se puede deshacer.`, 'Empezar envío', false)) return;
  $$('.cmp-final button').forEach(b => b.disabled = true);
  boton.textContent = 'Creando…';
  try {
    const r = await post('/campanas', {
      nombre: W.nombre.trim(), canal_id: W.canal, limite_diario: W.limite,
      plantilla: { nombre: W.plantilla.nombre, idioma: W.plantilla.idioma }, variables: W.variables,
      destinos: { contactos: W.todos ? [] : [...W.sel.keys()], filtros: W.todos ? W.filtros : null, lista: W.lista }
    });
    if (empezar) await post(`/campanas/${r.id}/iniciar`, {});
    const notas = [r.bajas && `${n(r.bajas)} omitidos por BAJA`, r.invalidos && `${n(r.invalidos)} números inválidos descartados`].filter(Boolean).join(' · ');
    toast(`${empezar ? 'Envío iniciado' : 'Campaña guardada'}: ${n(r.total)} destinatarios${notas ? '. ' + notas : ''}.`, 'ok', 'Campañas');
    W = null; verDetalle(r.id);
  } catch (e) {
    toast(e.message, 'bad', 'Campañas');
    $$('.cmp-final button').forEach(b => b.disabled = false);
    boton.textContent = empezar ? 'Crear y empezar envío' : 'Guardar sin enviar';
  }
}

/* ================= Permisos (Administración) ================= */
export async function vistaPermisosCampanas(caja) {
  if (!esAdmin()) { caja.innerHTML = '<div class="card-box">Solo administración.</div>'; return; }
  caja.innerHTML = skeleton(4);
  let lista = await get('/campanas/permisos');
  const pintar = () => {
    const con = lista.filter(u => u.acceso).length;
    caja.innerHTML = `<div class="card-box cmp-permisos">
      <h3>Quién usa Campañas</h3>
      <p class="sub">Campañas envía mensajes masivos con costo desde la línea verificada. Administración siempre tiene acceso; los gerentes lo tienen salvo que se lo quites. ${n(con)} de ${n(lista.length)} personas tienen acceso.</p>
      <label class="adm-buscar"><span class="sr">Buscar persona</span><input id="cp-q" type="search" placeholder="Buscar persona…"></label>
      <div class="cmp-scroll alto"><table><thead><tr><th>Persona</th><th>Rol</th><th class="hide-m">Sucursal</th><th>Acceso</th><th></th></tr></thead><tbody>
      ${lista.map(u => `<tr data-nom="${esc((u.nombre + ' ' + u.rol + ' ' + (u.sucursal || '')).toLowerCase())}">
        <td><b>${esc(u.nombre)}</b></td><td>${esc(u.rol)}</td><td class="hide-m">${esc(u.sucursal || '—')}</td>
        <td><label class="cmp-sw"><span class="sw"><input type="checkbox" data-cp="${esc(u.id)}" ${u.acceso ? 'checked' : ''} ${u.fijo ? 'disabled' : ''} aria-label="Acceso de ${esc(u.nombre)} a Campañas"><i></i></span>
          <small>${u.fijo ? 'Siempre' : u.porDefecto ? 'Por su rol' : 'Ajustado a mano'}</small></label></td>
        <td>${!u.fijo && !u.porDefecto ? `<button class="btn ghost sm" data-cpd="${esc(u.id)}">Volver a lo de su rol</button>` : ''}</td></tr>`).join('')}
      </tbody></table></div></div>`;
    $('#cp-q').oninput = e => { const q = e.target.value.trim().toLowerCase(); $$('tr[data-nom]', caja).forEach(f => f.hidden = !!q && !f.dataset.nom.includes(q)); };
    $$('[data-cp]', caja).forEach(ch => ch.onchange = () => guardar(ch.dataset.cp, { permitido: ch.checked }, ch));
    $$('[data-cpd]', caja).forEach(b => b.onclick = () => guardar(b.dataset.cpd, { porDefecto: true }, b));
  };
  const guardar = async (id, cuerpo, el) => {
    el.disabled = true;
    try {
      lista = await put('/campanas/permisos/' + encodeURIComponent(id), cuerpo);
      const u = lista.find(x => x.id === id);
      toast(`${u?.nombre || 'Persona'}: ${u?.acceso ? 'con acceso' : 'sin acceso'} a Campañas`, 'ok', 'Permisos');
      pintar();
    } catch (e) { el.disabled = false; if (el.type === 'checkbox') el.checked = !el.checked; toast(e.message, 'bad', 'Permisos'); }
  };
  pintar();
}

/** Al perder acceso o cerrar sesión: se borra lo que quedó a medio cargar. */
export function reiniciarCampanas() { clearInterval(sondeo); W = null; pantalla = 'lista'; campanaId = null; }
