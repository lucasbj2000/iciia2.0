/* ============ Soporte IMPAR ============
   Cada usuario carga y sigue sus solicitudes. Los gerentes elegidos por el admin dan la
   primera aprobación; el admin confirma si se hace. Los observadores (que configura el admin)
   ven todas en modo lectura y el resumen. */
import { $, $$, esc, S, get, post, put, fd, fdate, ago, toast, modal, cerrar, vacio, skeleton, fx } from './core.js';
import { subir } from './adjuntos.js';

let CTX = null;
let PESTANA = 'mias';
let DIAS_RESUMEN = 30;
let abierta = null; // id de la solicitud abierta en el detalle

const ICONO_TIPO = { consulta: '?', falla: '!', mejora: '+' };
const AYUDA_TIPO = {
  consulta: 'Una duda sobre cómo usar el CRM.',
  falla: 'Algo no funciona como debería.',
  mejora: 'Una idea para que el CRM te ayude más.'
};
const ESTADO_CORTO = {
  gerencia: 'En gerencia', administracion: 'En administración', aprobada: 'Aprobada', resuelta: 'Resuelta', rechazada: 'No aprobada'
};
const num = n => 'N.º ' + String(n).padStart(4, '0');

async function contexto() { CTX = await get('/soporte/contexto'); return CTX; }

export async function vistaSoporte() {
  $('#view').innerHTML = `<div class="section">${skeleton(4)}</div>`;
  await contexto();
  const r = CTX.roles;
  const pestanas = [['mias', 'Mis solicitudes']];
  if (r.esAdmin || r.esAprobador) pestanas.push(['aprobar', 'Por revisar', CTX.pendientes]);
  if (r.veTodo) pestanas.push(['todas', 'Todas'], ['resumen', 'Resumen']);
  if (r.esAdmin) pestanas.push(['config', 'Quién aprueba y quién ve']);
  if (!pestanas.some(p => p[0] === PESTANA)) PESTANA = 'mias';

  $('#view').innerHTML = `<div class="section fx-vista sop">
    <div class="sop-barra">
      <div class="sop-tabs" role="tablist">${pestanas.map(([k, t, n]) =>
        `<button role="tab" data-sop-tab="${k}" class="${PESTANA === k ? 'on' : ''}" aria-selected="${PESTANA === k}">${t}${n ? ` <span class="sop-n">${n}</span>` : ''}</button>`).join('')}</div>
      <button class="btn" id="sop-nueva">+ Nueva solicitud</button></div>
    <div id="sop-cuerpo"></div></div>`;
  $$('[data-sop-tab]').forEach(b => b.onclick = () => { PESTANA = b.dataset.sopTab; vistaSoporte(); });
  $('#sop-nueva').onclick = () => nuevaSolicitud();
  await pintarPestana();
}

async function pintarPestana() {
  const box = $('#sop-cuerpo'); if (!box) return;
  if (PESTANA === 'resumen') return pintarResumen(box);
  if (PESTANA === 'config') return pintarConfig(box);
  box.innerHTML = skeleton(3);
  const lista = await get(`/soporte?vista=${PESTANA}`);
  if (!lista.length) {
    box.innerHTML = `<div class="card-box">${PESTANA === 'mias'
      ? vacio('✉', 'Todavía no enviaste solicitudes', 'Si tenés una duda, encontraste una falla o se te ocurre una mejora, contanos desde “Nueva solicitud”.')
      : PESTANA === 'aprobar' ? vacio('✓', 'No hay solicitudes para revisar', 'Te avisamos cuando llegue una nueva.')
      : vacio('✉', 'Sin solicitudes', '')}</div>`;
    return;
  }
  const verAutor = PESTANA !== 'mias';
  box.innerHTML = `<div class="sop-lista">${lista.map(s => tarjeta(s, verAutor)).join('')}</div>`;
  $$('[data-sop]', box).forEach(el => el.onclick = () => detalle(el.dataset.sop));
}

function tarjeta(s, verAutor) {
  return `<button class="sop-ticket t-${s.tipo}" data-sop="${s.id}">
    <span class="sop-talon"><span class="sop-ico" aria-hidden="true">${ICONO_TIPO[s.tipo]}</span><b>${num(s.numero)}</b><small>${esc(CTX.tipos[s.tipo])}</small></span>
    <span class="sop-cuerpo">
      <span class="sop-titulo">${esc(s.titulo)}</span>
      <span class="sop-meta">${esc(CTX.modulos[s.modulo] || s.modulo)} · ${verAutor ? esc(s.autor_nombre || '—') + ' · ' : ''}${ago(s.creado)} atrás
        ${s.tipo === 'falla' && s.impacto === 'alto' ? '<span class="sop-urgente">Impide trabajar</span>' : ''}</span>
      ${ruta(s, true)}
    </span>
    <span class="sop-estado e-${s.estado}">${ESTADO_CORTO[s.estado]}${s.acciones?.length ? '<small>Requiere tu decisión</small>' : ''}</span>
  </button>`;
}

/* La ruta de la solicitud: Enviada → Gerencia → Administración → Resuelta. */
function ruta(s, compacta = false) {
  const rech = s.estado === 'rechazada' ? (s.rechazo_etapa || 'gerencia') : null;
  const sinGerencia = !s.gerente_ts && ['administracion', 'aprobada', 'resuelta'].includes(s.estado);
  const paradas = [
    { k: 'enviada', t: 'Enviada', est: 'hecha', quien: s.autor_nombre, cuando: s.creado },
    { k: 'gerencia', t: 'Gerencia',
      est: rech === 'gerencia' ? 'rechazada' : s.estado === 'gerencia' ? 'actual' : sinGerencia ? 'omitida' : 'hecha',
      quien: s.gerente_nombre, cuando: s.gerente_ts },
    { k: 'administracion', t: 'Administración',
      est: rech === 'administracion' ? 'rechazada' : rech ? 'pendiente' : s.estado === 'administracion' ? 'actual'
        : ['aprobada', 'resuelta'].includes(s.estado) ? 'hecha' : 'pendiente',
      quien: s.admin_nombre, cuando: s.admin_ts },
    { k: 'resuelta', t: s.estado === 'aprobada' ? 'En preparación' : 'Resuelta',
      est: s.estado === 'resuelta' ? 'hecha' : s.estado === 'aprobada' ? 'actual' : 'pendiente', cuando: s.resuelta_ts }
  ];
  const txtEst = { hecha: 'completada', actual: 'en curso', rechazada: 'no aprobada', omitida: 'no requerida', pendiente: 'pendiente' };
  return `<ol class="sop-ruta ${compacta ? 'compacta' : ''}" aria-label="Recorrido de la solicitud">${paradas.map(p =>
    `<li class="p-${p.est}"><span class="sop-punto" aria-hidden="true"></span>
      <span class="sop-paso"><b>${p.t}</b><span class="sr">: ${txtEst[p.est]}</span>
      ${!compacta ? `<small>${p.est === 'omitida' ? 'No requerida' : p.est === 'rechazada' ? 'No aprobada' : p.est === 'actual' ? 'En curso' : p.cuando ? fdate(p.cuando) : 'Pendiente'}${p.quien && p.est !== 'pendiente' && p.est !== 'actual' && p.k !== 'enviada' ? ' · ' + esc(p.quien) : ''}</small>` : ''}</span></li>`).join('')}</ol>`;
}

/* ---------- Nueva solicitud: primero el tipo, después el detalle ---------- */
function nuevaSolicitud(tipo) {
  if (!tipo) {
    modal(`<div class="modal-h"><h3>¿Qué querés hacer?</h3><button class="x" data-cerrar aria-label="Cerrar">✕</button></div>
      <div class="modal-b"><div class="sop-tipos">${Object.keys(CTX.tipos).map(k => `
        <button class="sop-tipo t-${k}" data-tipo="${k}"><span class="sop-ico" aria-hidden="true">${ICONO_TIPO[k]}</span>
          <b>${k === 'falla' ? 'Informar una falla' : k === 'mejora' ? 'Pedir una mejora' : 'Hacer una consulta'}</b>
          <small>${AYUDA_TIPO[k]}</small></button>`).join('')}</div>
        <p class="sop-aviso">${CTX.hayAprobadores ? 'Primero la revisa un gerente y después administración. Vas a ver cada paso en “Mis solicitudes”.'
          : 'La revisa administración. Vas a ver cada paso en “Mis solicitudes”.'}</p></div>`);
    $('.modal')?.classList.add('sop-modal');
    $$('[data-cerrar]').forEach(b => b.onclick = cerrar);
    $$('[data-tipo]').forEach(b => b.onclick = () => nuevaSolicitud(b.dataset.tipo));
    return;
  }
  const esFalla = tipo === 'falla';
  const adj = !!fx('adjuntos');
  modal(`<div class="modal-h"><h3>${esFalla ? 'Informar una falla' : tipo === 'mejora' ? 'Pedir una mejora' : 'Hacer una consulta'}</h3>
      <button class="x" data-cerrar aria-label="Cerrar">✕</button></div>
    <div class="modal-b sop-form">
      <button class="sop-volver" id="sop-volver">‹ Cambiar tipo</button>
      <div class="field"><label for="sop-titulo">${esFalla ? '¿Qué falla?' : tipo === 'mejora' ? '¿Qué te gustaría mejorar?' : '¿Cuál es tu consulta?'}</label>
        <input id="sop-titulo" maxlength="140" placeholder="${esFalla ? 'Ej.: No puedo enviar fotos desde el celular' : tipo === 'mejora' ? 'Ej.: Filtrar contactos por ciudad' : 'Ej.: ¿Cómo transfiero un cliente a otra sucursal?'}"></div>
      <div class="field"><label for="sop-modulo">¿En qué parte del CRM?</label>
        <select id="sop-modulo">${Object.entries(CTX.modulos).map(([k, t]) => `<option value="${k}" ${S.vista && k.startsWith(S.vista) ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></div>
      <div class="field"><label for="sop-desc">${esFalla ? 'Contanos qué hiciste, qué pasó y qué esperabas que pasara' : 'Detalle'}</label>
        <textarea id="sop-desc" rows="5" maxlength="4000" placeholder="${esFalla ? '1. Abrí una conversación…\n2. Toqué el clip y elegí una foto…\n3. Apareció un error…' : 'Contá con tus palabras lo que necesitás.'}"></textarea></div>
      ${esFalla ? `<fieldset class="sop-impacto"><legend>¿Cuánto te afecta?</legend>${Object.entries(CTX.impactos).map(([k, t]) =>
        `<label><input type="radio" name="sop-imp" value="${k}" ${k === 'medio' ? 'checked' : ''}><span>${esc(t)}</span></label>`).join('')}</fieldset>` : ''}
      ${adj ? `<div class="field"><label>Captura de pantalla <span class="sop-opc">(opcional)</span></label>
        <div class="sop-adj"><button class="btn ghost sm" id="sop-adj-btn" type="button">Adjuntar imagen</button><span id="sop-adj-txt"></span>
        <input id="sop-adj" type="file" accept="image/*" class="hidden"></div></div>` : ''}
      <p class="sop-aviso">Junto con tu solicitud se guardan datos técnicos del equipo (navegador y tamaño de pantalla) para poder revisarla.</p>
      <div class="sop-pie"><button class="btn ghost" data-cerrar>Cancelar</button><button class="btn" id="sop-enviar">Enviar solicitud</button></div>
    </div>`);
  $('.modal')?.classList.add('sop-modal');
  $$('[data-cerrar]').forEach(b => b.onclick = cerrar);
  $('#sop-volver').onclick = () => nuevaSolicitud();
  let archivoId = null;
  if (adj) {
    $('#sop-adj-btn').onclick = () => $('#sop-adj').click();
    $('#sop-adj').onchange = async e => {
      const f = e.target.files[0]; if (!f) return;
      $('#sop-adj-txt').textContent = 'Subiendo…'; $('#sop-enviar').disabled = true;
      try { const a = await subir(f, p => { $('#sop-adj-txt').textContent = `Subiendo ${p}%`; }); archivoId = a.id; $('#sop-adj-txt').textContent = f.name; }
      catch (err) { $('#sop-adj-txt').textContent = ''; toast(err.message, 'bad'); }
      finally { $('#sop-enviar').disabled = false; }
    };
  }
  $('#sop-titulo').focus();
  $('#sop-enviar').onclick = async () => {
    const b = $('#sop-enviar'); b.disabled = true;
    try {
      const s = await post('/soporte', {
        tipo, titulo: $('#sop-titulo').value, modulo: $('#sop-modulo').value, descripcion: $('#sop-desc').value,
        impacto: $('input[name="sop-imp"]:checked')?.value || 'medio', archivoId,
        contexto: { vista: S.vista, pantalla: `${innerWidth}x${innerHeight}`, navegador: navigator.userAgent,
          version: document.querySelector('script[src*="app.js"]')?.src.split('v=')[1] || '' }
      });
      cerrar(); toast(`Tu solicitud ${num(s.numero)} fue enviada`, 'ok', 'Solicitud enviada');
      PESTANA = 'mias'; if (S.vista === 'sop') vistaSoporte();
    } catch (e) { toast(e.message, 'warn'); b.disabled = false; }
  };
}

/* ---------- Detalle ---------- */
export async function detalle(id) {
  abierta = id;
  if (!CTX) await contexto();
  let s;
  try { s = await get(`/soporte/${id}`); } catch (e) { toast(e.message, 'warn'); return; }
  const r = CTX.roles, propia = s.autor_id === S.usuario.id;
  const puedeComentar = propia || r.esAdmin || r.esAprobador;
  const NOMBRE_EV = { creada: 'Envió la solicitud', aprobada_gerencia: 'Aprobó y la pasó a administración', confirmada: 'Confirmó que se va a hacer',
    resuelta: 'La marcó como resuelta', rechazada: 'No la aprobó', comentario: 'Comentó' };
  const acc = s.acciones || [];
  const BOTON = {
    aprobar: ['Aprobar y pasar a administración', 'btn'], confirmar: ['Confirmar: se va a hacer', 'btn'],
    resolver: [s.tipo === 'consulta' ? 'Responder y resolver' : 'Marcar como resuelta', 'btn ok'], rechazar: ['No aprobar', 'btn danger']
  };
  modal(`<div class="modal-h sop-det-h t-${s.tipo}"><div><span class="sop-numero">${num(s.numero)} · ${esc(CTX.tipos[s.tipo])}</span>
      <h3>${esc(s.titulo)}</h3></div><button class="x" data-cerrar aria-label="Cerrar">✕</button></div>
    <div class="modal-b">
      ${ruta(s)}
      <dl class="sop-datos">
        <div><dt>Envió</dt><dd>${esc(s.autor_nombre || '—')}${s.autor_sucursal ? ' · ' + esc(s.autor_sucursal) : ''}</dd></div>
        <div><dt>Parte del CRM</dt><dd>${esc(CTX.modulos[s.modulo] || s.modulo)}</dd></div>
        ${s.tipo === 'falla' ? `<div><dt>Impacto</dt><dd>${esc(CTX.impactos[s.impacto])}</dd></div>` : ''}
        <div><dt>Fecha</dt><dd>${fdate(s.creado)}</dd></div></dl>
      <div class="sop-desc">${esc(s.descripcion).replace(/\n/g, '<br>')}</div>
      ${s.archivo?.url ? `<a class="sop-captura" href="${esc(s.archivo.url)}" target="_blank" rel="noopener"><img src="${esc(s.archivo.url)}" alt="Captura adjunta"></a>` : ''}
      ${(r.esAdmin || r.esAprobador || r.esObservador) && s.contexto && (s.contexto.navegador || s.contexto.pantalla) ? `<details class="sop-tecnico"><summary>Datos técnicos del equipo</summary>
        <p>Pantalla: ${esc(s.contexto.pantalla || '—')} · Sección: ${esc(s.contexto.vista || '—')} · Versión: ${esc(s.contexto.version || '—')}</p>
        <p>${esc(s.contexto.navegador || '')}</p></details>` : ''}
      <h4 class="sop-sub">Historial</h4>
      <ol class="sop-historial">${s.eventos.map(e => `<li class="ev-${e.tipo}"><b>${esc(e.usuario_nombre || 'Sistema')}</b> ${NOMBRE_EV[e.tipo] || e.tipo}
        <small>${fdate(e.ts)}</small>${e.texto ? `<p>${esc(e.texto).replace(/\n/g, '<br>')}</p>` : ''}</li>`).join('')}</ol>
      ${acc.length ? `<div class="sop-decision"><h4 class="sop-sub">Tu decisión</h4>
        <textarea id="sop-nota" rows="3" placeholder="${acc.includes('rechazar') ? 'Nota para quien envió la solicitud (obligatoria si no la aprobás)' : 'Respuesta o nota para quien envió la solicitud'}"></textarea>
        <div class="sop-pie">${acc.map(a => `<button class="${BOTON[a][1]}" data-accion="${a}">${BOTON[a][0]}</button>`).join('')}</div></div>` : ''}
      ${puedeComentar ? `<div class="sop-comentar"><textarea id="sop-com" rows="2" placeholder="Escribí un comentario"></textarea>
        <button class="btn ghost" id="sop-com-btn">Comentar</button></div>`
        : '<p class="sop-aviso">Podés leer esta solicitud. Solo quienes intervienen en el flujo pueden comentarla.</p>'}
    </div>`);
  $('.modal')?.classList.add('sop-modal', 'sop-modal-det');
  $$('[data-cerrar]').forEach(b => b.onclick = () => { abierta = null; cerrar(); });
  $$('[data-accion]').forEach(b => b.onclick = async () => {
    $$('[data-accion]').forEach(x => x.disabled = true);
    try {
      await post(`/soporte/${s.id}/decision`, { accion: b.dataset.accion, nota: $('#sop-nota').value });
      toast('Decisión registrada', 'ok'); await detalle(s.id); refrescarSoporte();
    } catch (e) { toast(e.message, 'warn'); $$('[data-accion]').forEach(x => x.disabled = false); }
  });
  if ($('#sop-com-btn')) $('#sop-com-btn').onclick = async () => {
    try { await post(`/soporte/${s.id}/comentarios`, { texto: $('#sop-com').value }); await detalle(s.id); refrescarSoporte(); }
    catch (e) { toast(e.message, 'warn'); }
  };
}

/* ---------- Resumen (mini reportería) ---------- */
async function pintarResumen(box) {
  box.innerHTML = skeleton(3);
  const d = await get(`/soporte/resumen?dias=${DIAS_RESUMEN}`);
  const barras = (obj, nombres, clase = '') => {
    const filas = Object.entries(obj);
    const max = Math.max(1, ...filas.map(([, v]) => v));
    return filas.map(([k, v]) => `<div class="sop-fila"><div class="sop-fila-t"><span>${clase === 'tipo' ? `<i class="sop-sw t-${k}"></i>` : ''}${esc(nombres[k] || k)}</span><b>${v}</b></div>
      <div class="sop-pista"><i class="${clase === 'tipo' ? 'b-' + k : clase === 'estado' ? 'e-' + k : ''}" style="width:${v / max * 100}%"></i></div></div>`).join('');
  };
  const horas = h => h == null ? '—' : h >= 48 ? `${Math.round(h / 24)} días` : h >= 1 ? `${Math.round(h)} h` : `${Math.max(1, Math.round(h * 60))} min`;
  // Semanas apiladas por tipo
  const semanas = {};
  d.semanas.forEach(x => { const k = String(x.semana).slice(0, 10); (semanas[k] = semanas[k] || { consulta: 0, falla: 0, mejora: 0 })[x.tipo] = x.n; });
  const listaSem = Object.entries(semanas);
  const maxSem = Math.max(1, ...listaSem.map(([, v]) => v.consulta + v.falla + v.mejora));
  box.innerHTML = `<div class="sop-res">
    <div class="sop-res-barra"><p class="sop-aviso">Solicitudes de ${DIAS_RESUMEN === 365 ? 'el último año' : `los últimos ${DIAS_RESUMEN} días`} y todas las que siguen abiertas.</p>
      <div class="rep-rango sop-rango" role="group" aria-label="Período">${[7, 30, 90, 365].map(x =>
        `<button data-dias="${x}" class="${DIAS_RESUMEN === x ? 'on' : ''}" aria-pressed="${DIAS_RESUMEN === x}">${x === 365 ? '1 año' : x + ' días'}</button>`).join('')}</div></div>
    <div class="card-box sop-cifras">
      <div><span>Abiertas</span><b>${d.abiertas}</b><small>de ${d.total} en el período</small></div>
      <div class="${d.fallasAbiertasAlto ? 'alerta' : ''}"><span>Fallas que impiden trabajar</span><b>${d.fallasAbiertasAlto}</b><small>sin resolver</small></div>
      <div><span>Hasta la aprobación de gerencia</span><b>${horas(d.horasGerencia)}</b><small>promedio</small></div>
      <div><span>Hasta resolverse</span><b>${horas(d.horasResolucion)}</b><small>promedio</small></div>
      <div><span>Abierta más antigua</span><b>${d.abiertas ? horas(d.masAntigua) : '—'}</b><small>${d.abiertas ? 'esperando' : 'ninguna abierta'}</small></div>
    </div>
    <div class="sop-res-grid">
      <section class="card-box"><h3>Por tipo</h3>${barras(d.porTipo, CTX.tipos, 'tipo')}</section>
      <section class="card-box"><h3>Por estado</h3>${barras(d.porEstado, ESTADO_CORTO, 'estado')}</section>
      <section class="card-box"><h3>Dónde se reportan fallas</h3>
        ${d.fallasPorModulo.length ? d.fallasPorModulo.map(f => `<div class="sop-fila"><div class="sop-fila-t"><span>${esc(f.nombre)}</span><b>${f.n}</b></div>
          <div class="sop-pista"><i class="b-falla" style="width:${f.n / d.fallasPorModulo[0].n * 100}%"></i></div></div>`).join('')
          : vacio('✓', 'Sin fallas reportadas', 'Nadie informó fallas en este período.')}</section>
    </div>
    <section class="card-box"><h3>Solicitudes por semana</h3>
      <div class="sop-leyenda">${Object.keys(CTX.tipos).map(k => `<span><i class="sop-sw t-${k}"></i>${esc(CTX.tipos[k])}</span>`).join('')}</div>
      ${listaSem.length ? `<div class="sop-semanas">${listaSem.map(([k, v]) => {
        const tot = v.consulta + v.falla + v.mejora;
        return `<div class="sop-sem" title="Semana del ${fd(k + 'T12:00:00')}: ${v.consulta} consultas, ${v.falla} fallas, ${v.mejora} mejoras">
          <span class="sop-sem-l">${fd(k + 'T12:00:00').slice(0, 5)}</span>
          <span class="sop-sem-b" style="width:${tot / maxSem * 100}%">${['consulta', 'falla', 'mejora'].filter(t => v[t]).map(t => `<i class="b-${t}" style="flex:${v[t]}"></i>`).join('')}</span>
          <b>${tot}</b></div>`; }).join('')}</div>` : vacio('✉', 'Sin solicitudes en el período', '')}
    </section></div>`;
  $$('[data-dias]', box).forEach(b => b.onclick = () => { DIAS_RESUMEN = Number(b.dataset.dias); pintarResumen(box); });
}

/* ---------- Configuración (solo admin) ---------- */
function pintarConfig(box) {
  const c = CTX.config;
  const gerentes = c.usuarios.filter(u => u.rol === 'gerente');
  const fila = (u, grupo, marcado) => `<label class="sop-check"><input type="checkbox" data-grupo="${grupo}" value="${u.id}" ${marcado ? 'checked' : ''}>
    <span><b>${esc(u.nombre)}</b><small>${esc(u.rol)}${u.sucursal ? ' · ' + esc(u.sucursal) : ''}</small></span></label>`;
  box.innerHTML = `<div class="sop-config">
    <section class="card-box"><h3>Gerentes que dan la primera aprobación</h3>
      <p class="sop-aviso">Cualquiera de ellos puede aprobar o rechazar. Nadie aprueba su propia solicitud. Si no elegís ninguno, las solicitudes van directo a administración.</p>
      <div class="sop-checks">${gerentes.map(u => fila(u, 'aprobadores', c.aprobadores.includes(u.id))).join('')
        || vacio('◎', 'No hay usuarios con rol gerente', 'Asigná el rol desde Administración › Usuarios.')}</div></section>
    <section class="card-box"><h3>Observadores</h3>
      <p class="sop-aviso">Pueden ver todas las solicitudes y el resumen, sin aprobar ni comentar. Cada usuario siempre ve las suyas.</p>
      <input class="sop-buscar" id="sop-buscar" type="search" placeholder="Buscar usuario" aria-label="Buscar usuario">
      <div class="sop-checks">${c.usuarios.filter(u => u.rol !== 'admin').map(u => fila(u, 'observadores', c.observadores.includes(u.id))).join('')}</div></section>
    <div class="sop-pie"><button class="btn" id="sop-guardar">Guardar</button></div></div>`;
  $('#sop-buscar').oninput = e => {
    const q = e.target.value.trim().toLowerCase();
    $$('[data-grupo="observadores"]', box).forEach(i => { i.closest('label').hidden = q && !i.closest('label').textContent.toLowerCase().includes(q); });
  };
  $('#sop-guardar').onclick = async () => {
    const val = g => $$(`[data-grupo="${g}"]:checked`, box).map(i => i.value);
    try {
      await put('/soporte/config', { aprobadores: val('aprobadores'), observadores: val('observadores') });
      toast('Configuración de soporte guardada', 'ok'); vistaSoporte();
    } catch (e) { toast(e.message, 'warn'); }
  };
}

/** Refresca la vista y el detalle abierto cuando llega un evento en tiempo real. */
export function refrescarSoporte() {
  if (S.vista === 'sop' && ['mias', 'aprobar', 'todas'].includes(PESTANA)) {
    contexto().then(() => {
      const b = $('[data-sop-tab="aprobar"]');
      if (b) b.innerHTML = 'Por revisar' + (CTX.pendientes ? ` <span class="sop-n">${CTX.pendientes}</span>` : '');
      pintarPestana();
    }).catch(() => {});
  }
}
export const solicitudAbierta = () => abierta;
