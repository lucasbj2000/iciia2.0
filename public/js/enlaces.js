/* IMPAR · enlaces en mensajes. No interpreta HTML del cliente. */
const escapar = valor => String(valor ?? '').replace(/[&<>"']/g,
  caracter => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[caracter]));

// Permite enlaces HTTP/HTTPS, dominios sin esquema y direcciones de correo.
const PATRON = /(?:https?:\/\/|www\.)[^\s<>"']+|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,63}\b|(?<![A-Z0-9_@.-])(?:[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?\.)+[A-Z]{2,63}(?::\d{1,5})?(?:[/?#][^\s<>"']*)?/gi;

function separarPuntuacion(cadena) {
  let texto = cadena;
  while (texto.length) {
    const ultima = texto.at(-1);
    if (/[.,;:!?]/.test(ultima)) { texto = texto.slice(0, -1); continue; }
    const pareja = {')':'(',']':'[','}':'{'}[ultima];
    if (pareja && [...texto].filter(c => c === ultima).length > [...texto].filter(c => c === pareja).length) {
      texto = texto.slice(0, -1);
      continue;
    }
    break;
  }
  return texto;
}

function destino(texto) {
  if (/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,63}$/i.test(texto)) {
    return {href:'mailto:' + texto, correo:true};
  }
  try {
    const url = new URL(/^https?:\/\//i.test(texto) ? texto : 'https://' + texto);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) return null;
    return {href:url.href, correo:false};
  } catch { return null; }
}

/** HTML seguro para mensajes con enlaces que se abren aparte del CRM. */
export function enlazarTexto(valor) {
  const texto = String(valor ?? '');
  const encontrados = [...texto.matchAll(PATRON)];
  if (!encontrados.length) return escapar(texto);
  const html = [];
  let desde = 0;
  for (const coincidencia of encontrados) {
    const inicio = coincidencia.index;
    if (inicio < desde) continue;
    const limpio = separarPuntuacion(coincidencia[0]);
    const enlace = destino(limpio);
    html.push(escapar(texto.slice(desde, inicio)));
    if (enlace) {
      const titulo = enlace.correo ? 'Enviar correo' : 'Abrir enlace en una pestaña nueva';
      html.push('<a class="enlace-chat" href="' + escapar(enlace.href) +
        '" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer" title="' +
        titulo + '">' + escapar(limpio) + '</a>');
    } else html.push(escapar(limpio));
    desde = inicio + limpio.length;
  }
  html.push(escapar(texto.slice(desde)));
  return html.join('');
}
