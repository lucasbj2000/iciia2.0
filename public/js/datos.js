/* ============ Importación y exportación completa de datos ============ */
import { $, $$, esc, S, get, post, toast, modal, cerrar, confirmar, bajar, vacio, fx } from './core.js';

let columnas = [], analisis = null, textoArchivo = '';

export async function vistaDatos() {
  columnas = await get('/datos/columnas').catch(() => []);
  const cont = $('#adm-body') || $('#view');

  cont.innerHTML = `
   <div class="card-box" style="border-color:#2b5a7a">
     <h3>🔄 Migración de datos</h3>
     <div style="color:var(--muted);font-size:var(--fs-sm);line-height:1.7">
       Traé la información de otro sistema o llevate la tuya. La importación respeta la
       <b>fecha real de creación</b> de cada negociación, el responsable, la etapa y hasta la conversación,
       así el historial queda igual que en el sistema de origen.</div>
   </div>

   <div class="grid g2">
     <div class="card-box"><h3>⭱ Importar</h3>
       <p class="sub" style="margin-top:0">Archivo CSV separado por punto y coma, coma o tabulación.</p>
       <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
         <button class="btn ghost sm" id="d-plantilla">⭳ Descargar plantilla</button>
         <button class="btn ghost sm" id="d-ayuda">📖 Ver columnas</button></div>
       <div id="d-zona" style="border:2px dashed var(--line);border-radius:12px;padding:26px;text-align:center;
            cursor:pointer;transition:.22s var(--ease)">
         <div style="font-size:34px;margin-bottom:8px">📂</div>
         <b style="font-size:var(--fs-sm);display:block">Elegí el archivo o arrastralo acá</b>
         <small style="color:var(--muted)">CSV exportado de tu sistema anterior</small></div>
       <input id="d-file" type="file" accept=".csv,.txt,text/csv" class="hidden">
       <div id="d-analisis" style="margin-top:12px"></div></div>

     <div class="card-box"><h3>⭳ Exportar</h3>
       <p class="sub" style="margin-top:0">Llevate todo en el mismo formato que acepta la importación.</p>
       <div style="display:flex;flex-direction:column;gap:9px">
         <button class="btn" id="d-exp-todo">📊 Exportar negociaciones y contactos</button>
         <button class="btn ghost" id="d-exp-sin">📄 Exportar sin la conversación</button>
         <button class="btn ghost" id="d-exp-json">🗄 Respaldo completo (JSON)</button></div>
       <div style="color:var(--muted);font-size:var(--fs-xs);margin-top:14px;line-height:1.8">
         El <b>CSV</b> sirve para migrar a otro sistema o revisar en Excel.<br>
         El <b>respaldo JSON</b> incluye usuarios, sucursales, historial, transferencias y ubicaciones:
         guardalo antes de cualquier cambio grande.</div></div>
   </div>`;

  $('#d-plantilla').onclick = () => descargar('/api/datos/plantilla', 'plantilla_importacion.csv');
  $('#d-ayuda').onclick = modalColumnas;
  $('#d-exp-todo').onclick = () => descargar('/api/datos/exportar', `iciia_${S.empresa.codigo}.csv`);
  $('#d-exp-sin').onclick = () => descargar('/api/datos/exportar?mensajes=no', `iciia_${S.empresa.codigo}.csv`);
  $('#d-exp-json').onclick = () => descargar('/api/datos/respaldo', `respaldo_${S.empresa.codigo}.json`);

  const zona = $('#d-zona'), file = $('#d-file');
  zona.onclick = () => file.click();
  file.onchange = e => leerArchivo(e.target.files[0]);
  zona.addEventListener('dragover', e => {
    e.preventDefault(); zona.style.borderColor = 'var(--brand)'; zona.style.background = 'var(--glass)';
  });
  zona.addEventListener('dragleave', () => { zona.style.borderColor = 'var(--line)'; zona.style.background = ''; });
  zona.addEventListener('drop', e => {
    e.preventDefault(); zona.style.borderColor = 'var(--line)'; zona.style.background = '';
    if (e.dataTransfer.files[0]) leerArchivo(e.dataTransfer.files[0]);
  });
}

async function descargar(ruta, nombre) {
  try {
    const h = { Authorization: `Bearer ${S.token}` };
    if (S.usuario.esAdminGlobal) h['X-Empresa'] = S.empresa.id;
    const r = await fetch(ruta, { headers: h });
    if (!r.ok) throw new Error('No se pudo generar el archivo');
    const texto = await r.text();
    bajar(nombre, texto.replace(/^\uFEFF/, ''), nombre.endsWith('.json') ? 'application/json' : 'text/csv;charset=utf-8');
    toast('Archivo descargado', 'ok');
  } catch (e) { toast(e.message, 'bad'); }
}

function leerArchivo(f) {
  if (!f) return;
  if (f.size > 25 * 1024 * 1024) return toast('El archivo supera los 25 MB', 'bad');
  const rd = new FileReader();
  rd.onload = async () => {
    textoArchivo = String(rd.result);
    $('#d-analisis').innerHTML = `<div style="text-align:center;padding:20px"><span class="spin lg"></span>
      <div style="color:var(--muted);font-size:var(--fs-sm);margin-top:10px">Analizando…</div></div>`;
    try {
      analisis = await post('/datos/analizar', { texto: textoArchivo });
      pintarAnalisis(f.name);
    } catch (e) {
      $('#d-analisis').innerHTML = `<div class="card-box" style="margin:0;border-color:var(--bad)">
        <b style="font-size:var(--fs-sm);color:var(--bad)">No se pudo leer el archivo</b>
        <div style="color:var(--muted);font-size:var(--fs-sm);margin-top:5px">${esc(e.message)}</div></div>`;
    }
  };
  rd.onerror = () => toast('No se pudo leer el archivo', 'bad');
  rd.readAsText(f, 'utf-8');
}

function pintarAnalisis(nombreArchivo) {
  const a = analisis;
  const etapas = S.empresa.etapas || [];
  $('#d-analisis').innerHTML = `
    <div class="card-box fx-pop" style="margin:0;border-color:${a.faltantes.length ? 'var(--bad)' : 'var(--ok)'}">
      <div style="display:flex;gap:10px;align-items:center;margin-bottom:10px">
        <span style="font-size:24px">${a.faltantes.length ? '⚠' : '✓'}</span>
        <div style="flex:1"><b style="font-size:var(--fs-md)">${a.total} fila(s) detectada(s)</b>
          <small style="color:var(--muted);display:block">${esc(nombreArchivo)} · separador «${esc(a.separador)}»</small></div></div>

      ${a.faltantes.length ? `<div style="color:var(--bad);font-size:var(--fs-sm);margin-bottom:10px">
        Faltan columnas obligatorias: <b>${a.faltantes.join(', ')}</b></div>` : ''}

      <div style="font-size:var(--fs-xs);color:var(--muted);margin-bottom:10px">
        Columnas reconocidas: ${a.reconocidas.map(c => `<span class="tag t-wa">${esc(c)}</span>`).join(' ') || 'ninguna'}</div>

      ${a.avisos.length ? `<div style="background:var(--surface2);border-radius:9px;padding:11px;margin-bottom:12px">
        ${a.avisos.map(x => `<div style="font-size:var(--fs-sm);color:var(--warn);padding:3px 0">• ${esc(x)}</div>`).join('')}</div>` : ''}

      <details style="margin-bottom:12px"><summary style="cursor:pointer;font-size:var(--fs-sm);color:var(--muted)">
        Ver las primeras filas</summary>
        <div style="overflow:auto;max-height:200px;margin-top:9px"><table style="font-size:var(--fs-xs)">
          <thead><tr>${a.reconocidas.slice(0, 7).map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead>
          <tbody>${a.muestra.map(m => `<tr>${a.reconocidas.slice(0, 7).map(c =>
            `<td>${esc(String(m[c] || '').slice(0, 30))}</td>`).join('')}</tr>`).join('')}</tbody></table></div></details>

      <h3 style="font-size:var(--fs-sm);margin:14px 0 8px">Opciones</h3>
      <div class="row">
        <div class="field"><label>Etapa para filas sin etapa válida</label>
          <select id="o-etapa">${etapas.map(e =>
            `<option value="${e.id}" ${e.id === 'contactado' ? 'selected' : ''}>${esc(e.nombre)}</option>`).join('')}</select></div>
        <div class="field"><label>Si el cliente ya tiene una negociación abierta</label>
          <select id="o-dup">
            <option value="historico">Importar como histórico (cerrada)</option>
            <option value="omitir">Omitir la fila</option></select></div></div>
      <label style="display:flex;gap:8px;align-items:center;font-size:var(--fs-sm);padding:5px 0">
        <span class="sw"><input type="checkbox" id="o-marcar" checked><i></i></span> Marcar como «importado»</label>
      <label style="display:flex;gap:8px;align-items:center;font-size:var(--fs-sm);padding:5px 0">
        <span class="sw"><input type="checkbox" id="o-asignar"><i></i></span> Asignar agente a las filas sin responsable</label>
      <label style="display:flex;gap:8px;align-items:center;font-size:var(--fs-sm);padding:5px 0">
        <span class="sw"><input type="checkbox" id="o-solo"><i></i></span> Importar solo contactos, sin negociaciones</label>

      <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap">
        <button class="btn" id="d-importar" ${a.faltantes.length ? 'disabled' : ''}>⭱ Importar ${a.total} fila(s)</button>
        <button class="btn ghost" id="d-cancelar">Cancelar</button></div>
    </div>`;

  $('#d-cancelar').onclick = () => { $('#d-analisis').innerHTML = ''; analisis = null; textoArchivo = ''; };
  $('#d-importar').onclick = importar;
}

async function importar() {
  const opciones = {
    etapaPorDefecto: $('#o-etapa').value,
    duplicados: $('#o-dup').value,
    marcarImportadas: $('#o-marcar').checked,
    asignarSinResponsable: $('#o-asignar').checked,
    soloContactos: $('#o-solo').checked
  };
  if (!await confirmar('Confirmar importación',
    `Se van a procesar <b>${analisis.total}</b> fila(s) en <b>${esc(S.empresa.nombre)}</b>.<br><br>
     Conviene descargar antes el respaldo JSON, por si querés volver atrás.`,
    'Importar ahora', false)) return;

  const btn = $('#d-importar');
  btn.disabled = true;
  btn.innerHTML = '<span class="spin"></span> Importando… puede tardar unos minutos';
  try {
    const r = await post('/datos/importar', { texto: textoArchivo, opciones });
    $('#d-analisis').innerHTML = `<div class="card-box fx-pop" style="margin:0;border-color:var(--ok)">
      <div style="display:flex;gap:10px;align-items:center;margin-bottom:12px">
        <span style="font-size:26px">✅</span><b style="font-size:var(--fs-md)">Importación completada</b></div>
      <div class="grid g2" style="gap:9px">
        <div class="kpi"><span>Negociaciones</span><b>${r.negociaciones}</b></div>
        <div class="kpi"><span>Contactos nuevos</span><b>${r.contactosNuevos}</b></div>
        <div class="kpi"><span>Contactos actualizados</span><b class="chico">${r.contactosActualizados}</b></div>
        <div class="kpi"><span>Mensajes</span><b class="chico">${r.mensajes}</b></div></div>
      ${r.omitidas ? `<div style="color:var(--warn);font-size:var(--fs-sm);margin-top:10px">
        ${r.omitidas} fila(s) omitidas.</div>` : ''}
      ${r.errores.length ? `<details style="margin-top:10px"><summary style="cursor:pointer;color:var(--bad);font-size:var(--fs-sm)">
        ${r.errores.length} error(es) — ver detalle</summary>
        <div style="max-height:180px;overflow:auto;margin-top:8px;font-size:var(--fs-xs)">
        ${r.errores.map(e => `<div style="padding:4px 0;border-bottom:1px solid var(--line)">
          Línea ${e.linea}: ${esc(e.error)}</div>`).join('')}</div></details>` : ''}
      <button class="btn ghost sm" style="margin-top:12px" id="d-ver">Ver las negociaciones importadas</button></div>`;
    toast(`${r.negociaciones} negociaciones importadas`, 'ok', 'Migración');
    $('#d-ver').onclick = () => import('./app.js').then(m => m.ir('neg'));
  } catch (e) {
    toast(e.message, 'bad', 'Importación');
    btn.disabled = false;
    btn.textContent = `⭱ Importar ${analisis.total} fila(s)`;
  }
}

function modalColumnas() {
  modal(`<div class="modal-h"><h3>📖 Columnas del archivo</h3><button class="x" data-cerrar>✕</button></div>
   <div class="modal-b">
     <p class="sub" style="margin-top:0">El orden no importa: el sistema reconoce las columnas por su nombre.
       Las que no estén en esta lista se ignoran.</p>
     <table><thead><tr><th>Columna</th><th>Qué es</th><th>Ejemplo</th></tr></thead>
     <tbody>${columnas.map(c => `<tr>
       <td class="mono">${esc(c.k)}${c.req ? ' <span class="tag t-man">obligatorio</span>' : ''}</td>
       <td>${esc(c.t)}</td><td style="color:var(--muted)">${esc(c.ej || '—')}</td></tr>`).join('')}</tbody></table>
     <div class="card-box" style="background:var(--surface2);margin-top:14px">
       <b style="font-size:var(--fs-sm)">Formatos aceptados</b>
       <div style="color:var(--muted);font-size:var(--fs-sm);margin-top:7px;line-height:1.9">
         <b>Fechas:</b> <span class="mono">15/03/2024</span>, <span class="mono">2024-03-15 10:30</span>, <span class="mono">15-03-2024 10:30</span><br>
         <b>Etapa:</b> el identificador (<span class="mono">nuevo</span>, <span class="mono">contactado</span>,
           <span class="mono">espera</span>, <span class="mono">ganado</span>, <span class="mono">cerrado</span>) o el nombre visible<br>
         <b>Responsable:</b> el nombre de usuario o el nombre completo<br>
         <b>Conversación:</b> <span class="mono">in|texto del cliente ;; out|respuesta del agente</span><br>
         <b>Sí/No:</b> <span class="mono">si</span>, <span class="mono">no</span>, <span class="mono">1</span>, <span class="mono">0</span></div></div></div>
   <div class="modal-f"><button class="btn" data-cerrar>Entendido</button></div>`, true);
  $$('[data-cerrar]').forEach(b => b.onclick = cerrar);
}
