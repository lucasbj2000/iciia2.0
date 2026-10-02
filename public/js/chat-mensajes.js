// Conserva los nodos existentes, el audio en reproducción y la posición de lectura.
export function actualizarMensajes(caja, mensajes, render, seguir = false) {
  const alFinal = caja.scrollHeight - caja.scrollTop - caja.clientHeight < 64;
  const posicion = caja.scrollTop;
  const existentes = new Map([...caja.children].filter(el => el.dataset.mensajeId)
    .map(el => [el.dataset.mensajeId, el]));
  if (mensajes.length) caja.querySelectorAll('.empty').forEach(el => el.remove());
  for (const mensaje of mensajes) {
    const id = String(mensaje.id), html = render(mensaje);
    let nodo = existentes.get(id);
    if (!nodo || nodo._mensajeHTML !== html) {
      const plantilla = document.createElement('template'); plantilla.innerHTML = html;
      const nuevo = plantilla.content.firstElementChild;
      nuevo.dataset.mensajeId = id; nuevo._mensajeHTML = html;
      if (nodo) { nuevo.style.animation = 'none'; nodo.replaceWith(nuevo); }
      else caja.append(nuevo);
      nodo = nuevo;
    }
    existentes.delete(id);
    delete nodo.dataset.local;
  }
  // Los mensajes locales esperan la confirmación del POST; un SSE temprano no los borra.
  existentes.forEach(el => { if (!el.dataset.local) el.remove(); });
  caja.scrollTop = seguir || alFinal ? caja.scrollHeight : posicion;
}

let secuencia = 0;
export function confirmarIdPendiente(caja, localId, id) {
  if (!caja || !localId || !id) return;
  const local = [...caja.children].find(el => el.dataset.mensajeId === localId);
  if (!local) return;
  const real = [...caja.children].find(el => el.dataset.mensajeId === String(id));
  if (real && real !== local) { local.dataset.local = 'confirmado'; local.remove(); return; }
  local.dataset.mensajeId = String(id);
  local.dataset.local = 'confirmado';
  return local;
}

export function mostrarMensajePendiente(caja, mensaje, render) {
  const id = `local-${Date.now()}-${++secuencia}`;
  const m = { ...mensaje, id, estado: 'pendiente', ts: new Date().toISOString() };
  const plantilla = document.createElement('template'); plantilla.innerHTML = render(m);
  const nodo = plantilla.content.firstElementChild;
  nodo.dataset.mensajeId = id; nodo.dataset.local = 'enviando'; nodo._mensajeHTML = render(m);
  caja.querySelectorAll('.empty').forEach(el => el.remove());
  caja.append(nodo); caja.scrollTop = caja.scrollHeight;
  return {
    id,
    confirmar(servidor) {
      if (!servidor?.id) return;
      const local = confirmarIdPendiente(caja, id, servidor.id)
        || [...caja.children].find(el => el.dataset.mensajeId === String(servidor.id) && el.dataset.local === 'confirmado');
      // Si el SSE ya mostró el registro real, conservar su estado más reciente.
      if (!local) return;
      const html = render({ ...m, ...servidor });
      const p = document.createElement('template'); p.innerHTML = html;
      const nuevo = p.content.firstElementChild;
      nuevo.dataset.mensajeId = String(servidor.id); nuevo.dataset.local = 'confirmado';
      nuevo._mensajeHTML = html; nuevo.style.animation = 'none'; local.replaceWith(nuevo);
    },
    fallar() {
      if (nodo.dataset.local !== 'enviando') return false;
      nodo.remove(); return true;
    }
  };
}
