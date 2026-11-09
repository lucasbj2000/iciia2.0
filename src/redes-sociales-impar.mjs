/* IMPAR · Facebook Messenger e Instagram Direct (Facebook Login for Business).
   A partir de un token (de usuario del sistema o de página) el CRM encuentra la página,
   su cuenta de Instagram vinculada y el token de página; después suscribe la página a la app
   para que Meta mande los mensajes al webhook. */

const MINIMA = 24, VIGENTE = 'v26.0';
/** Versión de la Graph API: se ignoran versiones viejas que Meta retira (v21 se apaga el 21/01/2027). */
export function versionGraph(valor) {
  const n = Number(String(valor || '').match(/^v(\d+)\.\d+$/)?.[1]);
  return n >= MINIMA ? String(valor) : VIGENTE;
}
export const API = `https://graph.facebook.com/${versionGraph(process.env.GRAPH_VERSION)}`;
export const CAMPOS_PAGINA = ['messages', 'messaging_postbacks'];

async function llamar(fetchFn, url, token, opciones = {}) {
  const r = await fetchFn(url, {
    ...opciones,
    headers: { Authorization: `Bearer ${token}`, ...(opciones.body ? { 'Content-Type': 'application/json' } : {}) },
    signal: AbortSignal.timeout(15000)
  });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok && !j.error, j };
}

const paginaDe = p => ({
  page_id: String(p.id), page_nombre: p.name || '', token_pagina: p.access_token || '',
  ig_id: p.instagram_business_account?.id ? String(p.instagram_business_account.id) : '',
  ig_usuario: p.instagram_business_account?.username || ''
});

/**
 * Resuelve página, Instagram y token de página.
 * Devuelve { ok, cuenta } o { ok:false, error } o { ok:false, elegir:[páginas] } cuando hay varias.
 */
export async function resolverCuentaSocial({ tipo, token, page_id = '', ig_id = '' }, fetchFn = fetch) {
  token = String(token || '').trim();
  if (!token) return { ok: false, error: 'Falta el token.' };
  const campos = 'id,name,access_token,instagram_business_account{id,username}';
  // 1) Token de usuario (del sistema o personal): lista las páginas a las que tiene acceso.
  const cuentas = await llamar(fetchFn, `${API}/me/accounts?fields=${encodeURIComponent(campos)}&limit=100`, token);
  let paginas;
  if (cuentas.ok) paginas = (cuentas.j.data || []).map(paginaDe);
  else {
    // 2) Token de página: /me es la página misma.
    const yo = await llamar(fetchFn, `${API}/me?fields=${encodeURIComponent('id,name,instagram_business_account{id,username}')}`, token);
    if (!yo.ok) return { ok: false, error: traducirError(yo.j.error) };
    paginas = [{ ...paginaDe(yo.j), token_pagina: token }];
  }
  if (!paginas.length) return { ok: false, error: 'El token no tiene ninguna página asignada. En el portafolio, asigná la página de Facebook al usuario del sistema y generá el token de nuevo.' };

  let candidatas = paginas;
  if (page_id) candidatas = paginas.filter(p => p.page_id === String(page_id));
  else if (ig_id) candidatas = paginas.filter(p => p.ig_id === String(ig_id));
  else if (tipo === 'instagram') candidatas = paginas.filter(p => p.ig_id);
  if (!candidatas.length) {
    if (page_id || ig_id) return { ok: false, error: 'Esa página o cuenta de Instagram no está entre las que puede usar el token.' };
    return { ok: false, error: 'Ninguna página del token tiene una cuenta de Instagram profesional vinculada.' };
  }
  if (candidatas.length > 1) return { ok: false, elegir: candidatas.map(({ token_pagina, ...p }) => p) };
  const cuenta = candidatas[0];
  if (tipo === 'instagram' && !cuenta.ig_id)
    return { ok: false, error: `La página «${cuenta.page_nombre}» no tiene una cuenta de Instagram profesional vinculada.` };
  if (!cuenta.token_pagina)
    return { ok: false, error: 'Meta no devolvió el token de la página: el usuario del sistema necesita la página asignada con control total o la tarea «Mensajes».' };
  return { ok: true, cuenta };
}

/** Suscribe la página a la app (necesario también para Instagram vinculado a esa página). */
export async function suscribirPagina(pageId, tokenPagina, fetchFn = fetch) {
  const r = await llamar(fetchFn, `${API}/${pageId}/subscribed_apps`, tokenPagina, {
    method: 'POST', body: JSON.stringify({ subscribed_fields: CAMPOS_PAGINA })
  });
  return r.ok ? { ok: true } : { ok: false, error: traducirError(r.j.error) };
}

/** Errores de Meta en palabras que entiende el agente. */
export function traducirError(e = {}) {
  const codigo = Number(e.code), sub = Number(e.error_subcode);
  if (codigo === 10 && [2018278, 2018108].includes(sub) || sub === 2534022)
    return 'Pasaron más de 24 horas desde el último mensaje del cliente. Meta solo permite responder por Messenger e Instagram dentro de ese plazo: esperá a que el cliente vuelva a escribir.';
  if (codigo === 551 || sub === 1545041) return 'Esta persona no está disponible: bloqueó a la página o borró la conversación.';
  if (codigo === 190) return 'El token venció o fue revocado. Generá uno nuevo y cargalo en el canal.';
  if (codigo === 200 || codigo === 10 || codigo === 3)
    return 'Falta un permiso en el token (pages_messaging, pages_manage_metadata, instagram_manage_messages). Revisá los permisos del usuario del sistema.';
  if (codigo === 100 && /instagram/i.test(e.message || '')) return 'Instagram no permite esta acción para esa cuenta. Revisá que sea profesional y tenga activado «Permitir acceso a los mensajes».';
  return e.message || 'Error de Meta.';
}
