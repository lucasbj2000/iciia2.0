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
  }
  existentes.forEach(el => el.remove());
  caja.scrollTop = seguir || alFinal ? caja.scrollHeight : posicion;
}
