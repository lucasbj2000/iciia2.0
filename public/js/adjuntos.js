/* ============ Adjuntos: subir, pegar, arrastrar, cámara y visor ============ */
import { $, $$, esc, S, toast, esMovil, vibrar, fx } from './core.js';

export const ICONOS = { imagen: '🖼', video: '🎬', audio: '🎵', documento: '📎' };
export const ACEPTA = 'image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip,.rar';

export function pesoLegible(b) {
  b = Number(b) || 0;
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(0) + ' KB';
  return (b / 1048576).toFixed(1) + ' MB';
}

/** Sube un archivo con progreso real. */
export function subir(file, onProgreso) {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    fd.append('archivo', file, file.name || 'archivo');
    const x = new XMLHttpRequest();
    x.open('POST', '/api/archivos');
    x.setRequestHeader('Authorization', `Bearer ${S.token}`);
    if (S.empresa?.id && S.usuario?.esAdminGlobal) x.setRequestHeader('X-Empresa', S.empresa.id);
    x.upload.onprogress = e => {
      if (e.lengthComputable && onProgreso) onProgreso(Math.round(e.loaded / e.total * 100));
    };
    x.onload = () => {
      let r = {};
      try { r = JSON.parse(x.responseText); } catch (e) {}
      if (x.status >= 200 && x.status < 300) {
        if (r.avisoWA) toast(r.avisoWA, 'warn', 'Atención');
        resolve(r.archivo);
      } else reject(new Error(r.error || 'No se pudo subir el archivo'));
    };
    x.onerror = () => reject(new Error('Fallo la conexión al subir'));
    x.ontimeout = () => reject(new Error('La subida tardó demasiado'));
    x.timeout = 180000;
    x.send(fd);
  });
}

/** Abre el selector nativo. `modo` adapta el comportamiento en celular. */
export function elegirArchivo(modo = 'todo') {
  return new Promise(resolve => {
    const inp = document.createElement('input');
    inp.type = 'file';
    if (modo === 'camara') { inp.accept = 'image/*'; inp.capture = 'environment'; }
    else if (modo === 'video') { inp.accept = 'video/*'; inp.capture = 'environment'; }
    else if (modo === 'galeria') inp.accept = 'image/*,video/*';
    else if (modo === 'documento') inp.accept = '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip,.rar';
    else inp.accept = ACEPTA;
    inp.style.display = 'none';
    document.body.appendChild(inp);
    inp.onchange = e => { resolve(e.target.files[0] || null); inp.remove(); };
    inp.oncancel = () => { resolve(null); inp.remove(); };
    inp.click();
  });
}

/**
 * Conecta un campo con adjuntos: botón con menú, pegado, arrastre y cámara.
 * Funciona igual en PC y en celular.
 */
export function conectarAdjuntos({ inputSel, barraSel, botonSel, zonaSel, onCambio }) {
  const estado = { archivo: null };
  const barra = $(barraSel);
  const input = $(inputSel);
  const zona = zonaSel ? $(zonaSel) : null;

  const pintar = () => {
    if (!barra) return;
    if (!estado.archivo) { barra.innerHTML = ''; barra.hidden = true; return; }
    const a = estado.archivo;
    barra.hidden = false;
    barra.innerHTML = `<div class="adj-barra">
      ${a.tipo === 'imagen' && a.url ? `<img src="${esc(a.url)}" alt="">` : `<div class="ic">${ICONOS[a.tipo] || '📎'}</div>`}
      <div style="flex:1;min-width:0"><b>${esc(a.nombre)}</b>
        <small>${a.tipo} · ${pesoLegible(a.bytes)}${a.subiendo !== undefined ? ` · subiendo ${a.subiendo}%` : ''}</small>
        ${a.subiendo !== undefined ? `<div class="adj-prog"><i style="width:${a.subiendo}%"></i></div>` : ''}</div>
      <button class="x" data-quitar title="Quitar adjunto">✕</button></div>`;
    const q = barra.querySelector('[data-quitar]');
    if (q) q.onclick = () => { estado.archivo = null; pintar(); onCambio?.(null); };
  };

  const procesar = async file => {
    if (!file) return;
    estado.archivo = { nombre: file.name || 'archivo', bytes: file.size, tipo: tipoLocal(file.type), url: '', subiendo: 0 };
    // Vista previa local inmediata, sin esperar al servidor
    if (file.type.startsWith('image/')) {
      try { estado.archivo.url = URL.createObjectURL(file); } catch (e) {}
    }
    pintar();
    try {
      const a = await subir(file, p => { if (estado.archivo) { estado.archivo.subiendo = p; pintar(); } });
      if (estado.archivo?.url?.startsWith('blob:')) URL.revokeObjectURL(estado.archivo.url);
      estado.archivo = a; pintar(); onCambio?.(a); vibrar();
    } catch (e) {
      estado.archivo = null; pintar(); toast(e.message, 'bad', 'Adjunto');
    }
  };

  /* --- botón con menú de origen --- */
  const boton = $(botonSel);
  if (boton) {
    boton.onclick = e => {
      e.stopPropagation();
      const previo = $('.menu-adj');
      if (previo) { previo.remove(); return; }
      const menu = document.createElement('div');
      menu.className = 'menu-adj';
      const movil = esMovil();
      const opciones = movil
        ? [['camara', '📷', 'Tomar foto', 'Usa la cámara'],
           ['video', '🎥', 'Grabar video', 'Usa la cámara'],
           ['galeria', '🖼', 'Galería', 'Fotos y videos del teléfono'],
           ['documento', '📄', 'Documento', 'PDF, Word, Excel, ZIP'],
           ['todo', '📁', 'Otro archivo', 'Explorar todo']]
        : [['galeria', '🖼', 'Imagen o video', 'Desde tu computadora'],
           ['documento', '📄', 'Documento', 'PDF, Word, Excel, ZIP'],
           ['todo', '📁', 'Cualquier archivo', 'Explorar todo']];
      menu.innerHTML = opciones.map(([m, em, t, sub]) =>
        `<button data-modo="${m}"><span class="em">${em}</span>
          <span><b style="font-weight:600">${t}</b><small>${sub}</small></span></button>`).join('')
        + `<button data-modo="pegar" style="border-top:1px solid var(--line)">
             <span class="em">📋</span><span><b style="font-weight:600">Pegar del portapapeles</b>
             <small>También podés usar Ctrl+V en el mensaje</small></span></button>`;
      const cont = boton.closest('.row') || boton.parentElement;
      cont.style.position = cont.style.position || 'relative';
      cont.appendChild(menu);
      $$('[data-modo]', menu).forEach(b => b.onclick = async ev => {
        ev.stopPropagation();
        const modo = b.dataset.modo;
        menu.remove();
        if (modo === 'pegar') return pegarDelPortapapeles(procesar);
        procesar(await elegirArchivo(modo));
      });
      setTimeout(() => document.addEventListener('click', function cerrarMenu(ev) {
        if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('click', cerrarMenu); }
      }), 10);
    };
  }

  /* --- pegar con Ctrl+V / Cmd+V --- */
  if (input) {
    input.addEventListener('paste', e => {
      const items = [...(e.clipboardData?.items || [])];
      const it = items.find(x => x.kind === 'file');
      if (!it) return;
      const f = it.getAsFile();
      if (!f) return;
      e.preventDefault();
      procesar(renombrarSiHaceFalta(f));
    });
  }

  /* --- arrastrar y soltar --- */
  if (zona) {
    let capa = null, contador = 0;
    const quitarCapa = () => { if (capa) { capa.remove(); capa = null; } contador = 0; };
    zona.addEventListener('dragenter', e => {
      if (!e.dataTransfer?.types.includes('Files')) return;
      e.preventDefault(); contador++;
      if (!capa) {
        capa = document.createElement('div');
        capa.className = 'zona-drop';
        capa.innerHTML = '<b>📎 Soltá el archivo para adjuntarlo</b>';
        zona.style.position = zona.style.position || 'relative';
        zona.appendChild(capa);
      }
    });
    zona.addEventListener('dragover', e => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault(); });
    zona.addEventListener('dragleave', () => { if (--contador <= 0) quitarCapa(); });
    zona.addEventListener('drop', e => {
      if (!e.dataTransfer?.files?.length) return;
      e.preventDefault(); quitarCapa();
      procesar(e.dataTransfer.files[0]);
    });
  }

  return {
    get archivo() { return estado.archivo?.id ? estado.archivo : null; },
    tiene: () => !!estado.archivo?.id,
    limpiar: () => { estado.archivo = null; pintar(); },
    poner: a => { estado.archivo = a; pintar(); },
    cargar: procesar
  };
}

/** Lee el portapapeles del sistema (requiere permiso del navegador). */
export async function pegarDelPortapapeles(procesar) {
  if (!navigator.clipboard?.read) {
    return toast('Tu navegador no permite leer el portapapeles. Usá Ctrl+V sobre el campo de mensaje.', 'warn', 'Pegar');
  }
  try {
    const items = await navigator.clipboard.read();
    for (const it of items) {
      const tipo = it.types.find(t => t.startsWith('image/') || t.startsWith('video/'));
      if (tipo) {
        const blob = await it.getType(tipo);
        const ext = (tipo.split('/')[1] || 'png').split('+')[0];
        return procesar(new File([blob], `captura-${Date.now()}.${ext}`, { type: tipo }));
      }
    }
    toast('No hay ninguna imagen en el portapapeles.', 'warn', 'Pegar');
  } catch (e) {
    toast('No se pudo leer el portapapeles. Probá con Ctrl+V sobre el mensaje.', 'warn', 'Pegar');
  }
}

function renombrarSiHaceFalta(f) {
  const generico = !f.name || /^image\.(png|jpe?g)$/i.test(f.name);
  if (!generico) return f;
  const ext = (f.type.split('/')[1] || 'png').split('+')[0];
  return new File([f], `captura-${Date.now()}.${ext}`, { type: f.type });
}
function tipoLocal(mime) {
  if (!mime) return 'documento';
  if (mime.startsWith('image/')) return 'imagen';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'documento';
}

/** HTML del contenido multimedia de un mensaje. */
export function mediaHTML(m) {
  const url = m.media_url, tipo = m.archivo_tipo || m.media_tipo;
  if (!url) return '';
  const nombre = m.archivo_nombre || m.media_nombre || 'archivo';
  if (tipo === 'imagen')
    return `<img src="${esc(url)}" alt="${esc(nombre)}" loading="lazy" data-ver="${esc(url)}"
      data-nombre="${esc(nombre)}" data-tipo="imagen">`;
  if (tipo === 'video')
    return `<video src="${esc(url)}" controls preload="metadata" playsinline></video>`;
  if (tipo === 'audio')
    return `<audio src="${esc(url)}" controls preload="metadata"></audio>`;
  return `<a class="doc" href="${esc(url)}" target="_blank" rel="noopener" download="${esc(nombre)}">
    <span class="di">📎</span><div style="min-width:0"><b>${esc(nombre)}</b>
    <small>${(m.archivo_bytes || m.media_bytes) ? pesoLegible(m.archivo_bytes || m.media_bytes) : 'Descargar'}</small></div></a>`;
}

/** Visor a pantalla completa. */
export function abrirVisor(url, nombre, tipo = 'imagen') {
  const lb = document.createElement('div');
  lb.className = 'lightbox';
  lb.innerHTML = `
    ${tipo === 'video' ? `<video src="${esc(url)}" controls autoplay playsinline></video>`
      : `<img src="${esc(url)}" alt="${esc(nombre || '')}">`}
    <div class="lb-bar">
      <a class="btn ghost sm" href="${esc(url)}" download="${esc(nombre || 'archivo')}" title="Descargar">⭳</a>
      <button class="btn ghost sm" data-cerrar-lb>✕</button></div>
    ${nombre ? `<div class="lb-info">${esc(nombre)}</div>` : ''}`;
  document.body.appendChild(lb);
  const cerrarLb = () => { lb.remove(); document.removeEventListener('keydown', escLb); };
  const escLb = e => { if (e.key === 'Escape') cerrarLb(); };
  lb.onclick = e => { if (e.target === lb || e.target.closest('[data-cerrar-lb]')) cerrarLb(); };
  lb.querySelector('a')?.addEventListener('click', e => e.stopPropagation());
  document.addEventListener('keydown', escLb);
}

export function activarVisor(contenedor) {
  $$('[data-ver]', contenedor || document).forEach(el => {
    el.onclick = e => {
      e.stopPropagation();
      abrirVisor(el.dataset.ver, el.dataset.nombre, el.dataset.tipo || 'imagen');
    };
  });
}
