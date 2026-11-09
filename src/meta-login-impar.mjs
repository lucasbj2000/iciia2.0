/* IMPAR · «Conectar con Facebook» (Facebook Login for Business).
   El usuario inicia sesión en la ventana de Facebook (nunca en el CRM), elige la página y su Instagram,
   y el CRM recibe un código que cambia por tokens del lado del servidor. */
import crypto from 'node:crypto';
import { q } from './db.mjs';
import { cifrarToken, resolverToken } from './meta-secretos-impar.mjs';
import { API, versionGraph, listarPaginas, suscribirPagina, traducirError } from './redes-sociales-impar.mjs';

// App «IMPAR CRM» del portafolio Grupo Alamo (el ID de app es público).
export const APP_ID = process.env.META_APP_ID || '3081967318821039';
const DURACION_MIN = 15;
const VERSION = versionGraph(process.env.GRAPH_VERSION);

export const urlRetorno = base => `${String(base || '').replace(/\/$/, '')}/api/meta-login/retorno`;

export async function leerAjustes(empresaId) {
  const { rows } = await q('SELECT config_id FROM meta_login_ajustes WHERE empresa_id=$1', [empresaId]);
  return { configId: rows[0]?.config_id || '' };
}
export async function guardarAjustes(empresaId, configId) {
  await q(`INSERT INTO meta_login_ajustes(empresa_id,config_id) VALUES($1,$2)
           ON CONFLICT (empresa_id) DO UPDATE SET config_id=EXCLUDED.config_id, actualizado=now()`, [empresaId, configId]);
}

/** Abre un intento de inicio de sesión y devuelve la dirección del diálogo de Facebook. */
export async function iniciar({ empresaId, usuarioId, configId, base }) {
  await q('DELETE FROM meta_login_estados WHERE vence < now() - interval \'1 day\'');
  const state = crypto.randomBytes(32).toString('hex');
  await q(`INSERT INTO meta_login_estados(state,empresa_id,usuario_id,vence) VALUES($1,$2,$3,now()+($4||' minutes')::interval)`,
    [state, empresaId, usuarioId, String(DURACION_MIN)]);
  const p = new URLSearchParams({
    client_id: APP_ID, redirect_uri: urlRetorno(base), state, config_id: configId,
    response_type: 'code', override_default_response_type: 'true'
  });
  return { state, url: `https://www.facebook.com/${VERSION}/dialog/oauth?${p}` };
}

async function graph(fetchFn, ruta, params) {
  const r = await fetchFn(`${API}/${ruta}?${new URLSearchParams(params)}`, { signal: AbortSignal.timeout(15000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(traducirError(j.error));
  return j;
}

/** Facebook vuelve con ?code&state: se cambia el código por tokens y se guardan las páginas (tokens cifrados). */
export async function completar({ state, code, error, base }, fetchFn = fetch) {
  if (!/^[0-9a-f]{64}$/.test(String(state || ''))) return { ok: false, mensaje: 'El enlace de retorno no es válido. Volvé a tocar «Conectar con Facebook».' };
  const { rows } = await q("SELECT * FROM meta_login_estados WHERE state=$1", [state]);
  const e = rows[0];
  if (!e || e.estado !== 'pendiente') return { ok: false, mensaje: 'Este inicio de sesión ya se usó. Volvé a tocar «Conectar con Facebook».' };
  const fallar = async mensaje => {
    await q("UPDATE meta_login_estados SET estado='error', error=$2 WHERE state=$1", [state, mensaje]);
    return { ok: false, mensaje };
  };
  if (new Date(e.vence) < new Date()) return fallar('Pasaron más de 15 minutos. Volvé a tocar «Conectar con Facebook».');
  if (error || !code) return fallar(error === 'access_denied' ? 'Se canceló el inicio de sesión en Facebook.' : 'Facebook no devolvió la autorización.');
  if (!process.env.META_APP_SECRET) return fallar('Falta META_APP_SECRET en el servidor.');
  try {
    // Código → token corto → token largo (60 días). Los tokens de página que salen de un token largo no vencen.
    const corto = await graph(fetchFn, 'oauth/access_token', {
      client_id: APP_ID, client_secret: process.env.META_APP_SECRET, redirect_uri: urlRetorno(base), code: String(code)
    });
    const largo = await graph(fetchFn, 'oauth/access_token', {
      grant_type: 'fb_exchange_token', client_id: APP_ID, client_secret: process.env.META_APP_SECRET, fb_exchange_token: corto.access_token
    });
    const lista = await listarPaginas(largo.access_token, fetchFn);
    if (!lista.ok) return fallar(lista.error);
    const paginas = lista.paginas.filter(p => p.token_pagina);
    if (!paginas.length) return fallar('No elegiste ninguna página, o tu usuario no administra ninguna. Volvé a intentar y marcá la página de IMPAR.');
    const guardadas = paginas.map(p => ({ page_id: p.page_id, page_nombre: p.page_nombre, ig_id: p.ig_id, ig_usuario: p.ig_usuario, token: cifrarToken(p.token_pagina) }));
    await q("UPDATE meta_login_estados SET estado='listo', paginas=$2, error=NULL WHERE state=$1", [state, JSON.stringify(guardadas)]);
    return { ok: true, mensaje: 'Listo. Volvé al CRM para elegir qué conectar.' };
  } catch (err) {
    return fallar(err.message || 'No se pudo completar el inicio de sesión.');
  }
}

/** Estado para el navegador del admin: nunca incluye tokens. */
export async function verEstado(state, empresaId, usuarioId) {
  const { rows } = await q('SELECT estado,error,paginas,vence FROM meta_login_estados WHERE state=$1 AND empresa_id=$2 AND usuario_id=$3',
    [state, empresaId, usuarioId]);
  const e = rows[0];
  if (!e) return null;
  const vencido = e.estado === 'pendiente' && new Date(e.vence) < new Date();
  return {
    estado: vencido ? 'error' : e.estado, error: vencido ? 'Pasaron más de 15 minutos. Volvé a intentar.' : e.error,
    paginas: e.estado === 'listo' ? e.paginas.map(({ token, ...p }) => p) : []
  };
}

/** Crea (o actualiza si ya existe) el canal de una red para esa página. */
async function canalSocial({ empresaId, tipo, pagina, token, sucursalId }) {
  const clave = tipo === 'instagram' ? 'ig_id' : 'page_id';
  const valor = pagina[clave];
  const { rows: existentes } = await q(`SELECT id,empresa_id,nombre FROM canales WHERE tipo=$1 AND config->>$2=$3`, [tipo, clave, valor]);
  const ajeno = existentes.find(c => c.empresa_id !== empresaId);
  if (ajeno) throw new Error(`Esa cuenta ya está registrada en otro CRM.`);
  const extra = { token, page_id: pagina.page_id, ig_id: pagina.ig_id, page_nombre: pagina.page_nombre, ig_usuario: pagina.ig_usuario, via: 'facebook_login' };
  const propio = existentes[0];
  if (propio) {
    await q(`UPDATE canales SET config=config||$3::jsonb, activo=TRUE, estado='conectado', ultimo_error=NULL, ultima_conexion=now()
             WHERE id=$1 AND empresa_id=$2`, [propio.id, empresaId, JSON.stringify(extra)]);
    return { id: propio.id, nombre: propio.nombre, tipo, actualizado: true };
  }
  const nombre = tipo === 'instagram' ? `Instagram @${pagina.ig_usuario || pagina.ig_id}` : `Messenger ${pagina.page_nombre}`;
  const { rows } = await q(
    `INSERT INTO canales (empresa_id,sucursal_id,linea,tipo,nombre,config,activo,bot_activo,estado,ultima_conexion)
     VALUES ($1,$2,'',$3,$4,$5,TRUE,FALSE,'conectado',now()) RETURNING id,nombre`,
    [empresaId, sucursalId || null, tipo, nombre.slice(0, 80), JSON.stringify(extra)]);
  return { id: rows[0].id, nombre: rows[0].nombre, tipo, actualizado: false };
}

/** Conecta Messenger y/o Instagram de la página elegida. Un intento se usa una sola vez. */
export async function conectar({ state, empresaId, usuarioId, pageId, messenger, instagram, sucursalId }, fetchFn = fetch) {
  const vencido = () => Object.assign(new Error('El inicio de sesión venció o ya se usó. Volvé a tocar «Conectar con Facebook».'), { status: 409 });
  const { rows } = await q(`SELECT paginas FROM meta_login_estados
    WHERE state=$1 AND empresa_id=$2 AND usuario_id=$3 AND estado='listo' AND vence > now() - interval '45 minutes'`, [state, empresaId, usuarioId]);
  if (!rows[0]) throw vencido();
  // Primero se valida la elección: un error del admin no gasta el inicio de sesión.
  const pagina = rows[0].paginas.find(p => p.page_id === String(pageId));
  if (!pagina) throw Object.assign(new Error('Esa página no estaba entre las autorizadas.'), { status: 422 });
  if (!messenger && !instagram) throw Object.assign(new Error('Elegí Messenger, Instagram o ambos.'), { status: 422 });
  if (instagram && !pagina.ig_id) throw Object.assign(new Error(`La página «${pagina.page_nombre}» no tiene Instagram profesional vinculado.`), { status: 422 });
  const sus = await suscribirPagina(pagina.page_id, resolverToken(pagina.token), fetchFn);
  if (!sus.ok) throw Object.assign(new Error('No se pudo suscribir la página al webhook: ' + sus.error), { status: 409 });
  // Uso único: solo una petición puede consumir el intento.
  const tomado = await q("UPDATE meta_login_estados SET estado='usado' WHERE state=$1 AND estado='listo' RETURNING 1", [state]);
  if (!tomado.rowCount) throw vencido();
  const canales = [];
  if (messenger) canales.push(await canalSocial({ empresaId, tipo: 'messenger', pagina, token: pagina.token, sucursalId }));
  if (instagram) canales.push(await canalSocial({ empresaId, tipo: 'instagram', pagina, token: pagina.token, sucursalId }));
  return { pagina: { page_id: pagina.page_id, page_nombre: pagina.page_nombre, ig_usuario: pagina.ig_usuario }, canales };
}
