/* IMPAR · Contactos compartidos por WhatsApp (tarjeta vCard).
   El cliente comparte un contacto: el agente tiene que ver el nombre y el número, no solo un aviso. */

const MAX_CONTACTOS = 10;
const limpiar = v => String(v ?? '').replace(/\\([,;:\\])/g, '$1').replace(/\\n/gi, ' ').replace(/\s+/g, ' ').trim();

/** Nombre y teléfonos de una vCard (WhatsApp usa TEL;waid=595…:+595 …). */
export function leerVCard(vcard) {
  // Las líneas largas pueden venir partidas (continuación con espacio al inicio).
  const lineas = String(vcard || '').replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
  let nombre = '', empresa = '';
  const telefonos = [];
  for (const l of lineas) {
    const i = l.indexOf(':');
    if (i < 0) continue;
    const clave = l.slice(0, i), valor = l.slice(i + 1);
    const tipo = clave.split(';')[0].replace(/^item\d+\./i, '').toUpperCase();
    if (tipo === 'FN' && !nombre) nombre = limpiar(valor);
    else if (tipo === 'N' && !nombre) nombre = limpiar(valor.split(';').filter(Boolean).reverse().join(' '));
    else if (tipo === 'ORG' && !empresa) empresa = limpiar(valor.split(';')[0]);
    else if (tipo === 'TEL') {
      const waid = clave.match(/waid=(\d{6,15})/i)?.[1];
      const visible = limpiar(valor);
      const tel = /\d{6}/.test(visible.replace(/\D/g, '')) ? visible : waid ? '+' + waid : '';
      if (tel && !telefonos.includes(tel)) telefonos.push(tel);
    }
  }
  return { nombre: nombre || empresa, telefonos };
}

/** Texto que ve el agente en la conversación. */
export function textoContactos(lista) {
  const validos = (lista || []).filter(c => c && (c.nombre || c.telefonos?.length)).slice(0, MAX_CONTACTOS);
  if (!validos.length) return '[contacto compartido sin datos]';
  const linea = c => `${c.nombre || 'Sin nombre'} · ${c.telefonos?.length ? c.telefonos.join(' / ') : 'sin número'}`;
  if (validos.length === 1) return `👤 Contacto compartido: ${linea(validos[0])}`;
  return `👤 Contactos compartidos:\n${validos.map(c => '• ' + linea(c)).join('\n')}`;
}

/** Línea normal (QR / Baileys): contactMessage o contactsArrayMessage. */
export function contactosDeBaileys(mensaje) {
  const uno = c => {
    const v = leerVCard(c?.vcard);
    return { nombre: v.nombre || limpiar(c?.displayName), telefonos: v.telefonos };
  };
  if (mensaje?.contactMessage) return [uno(mensaje.contactMessage)];
  if (mensaje?.contactsArrayMessage) return (mensaje.contactsArrayMessage.contacts || []).map(uno);
  return null;
}

/** Línea verificada (Cloud API): mensaje de tipo «contacts». */
export function contactosDeCloud(contacts) {
  return (contacts || []).map(c => ({
    nombre: limpiar(c?.name?.formatted_name || [c?.name?.first_name, c?.name?.last_name].filter(Boolean).join(' ') || c?.org?.company),
    telefonos: [...new Set((c?.phones || []).map(p => limpiar(p.phone) || (p.wa_id ? '+' + p.wa_id : '')).filter(Boolean))]
  }));
}
