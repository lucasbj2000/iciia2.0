// IMPAR · WhatsApp con nombre de usuario (BSUID).
// Cuando un cliente activa su @usuario y oculta el número, Meta no manda «from» ni «wa_id»:
// solo el identificador de usuario de la empresa (BSUID), por ejemplo «PY.13491208655302741918».
// El CRM guarda ese identificador en externos.whatsapp (y whatsapp_bsuid) y responde con «recipient».

/** ¿Es un BSUID de WhatsApp? Los números nunca llevan punto; el BSUID siempre: país + «.» + id. */
export const esBSUID = v => /^[A-Z]{2}\.[A-Z0-9.]{6,}$/i.test(String(v || '').trim());

/** Remitente, BSUID y nombre visible de un mensaje entrante de Cloud API. */
export function remitenteCloud(m = {}, contactos = []) {
  const bsuid = String(m.from_user_id || '').trim();
  const perfil = contactos.find(c => (m.from && c.wa_id === m.from) || (bsuid && c.user_id === bsuid))
    || (contactos.length === 1 ? contactos[0] : null);
  const id = String(m.from || bsuid || perfil?.user_id || '').trim();
  const usuario = perfil?.profile?.username ? '@' + String(perfil.profile.username).replace(/^@/, '') : '';
  return { remitente: id, bsuid: bsuid || String(perfil?.user_id || ''), nombre: perfil?.profile?.name || usuario || '', usuario };
}

export const AVISO_SIN_NUMERO = 'El cliente usa nombre de usuario de WhatsApp y no compartió su número: solo se le puede responder por la línea verificada.';
