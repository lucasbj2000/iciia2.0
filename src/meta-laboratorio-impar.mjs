// Diagnóstico aislado: únicamente GET a rutas fijas; nunca escribe en Meta o el CRM.
export const PHONE_ID = '661580813700225';
export const WABA_ID = '703035692081905';
export function autorizadoLaboratorio(user, empresa) {
  return user?.rol === 'admin' && String(user.usuario).toLowerCase() === 'admin' && empresa?.codigo === 'impar';
}
export async function diagnosticarMeta(token, request = fetch) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{20,4096}$/.test(token)) {
    const e = new Error('Ingresá un token de acceso válido.'); e.status = 422; throw e;
  }
  const version = /^v\d+\.0$/.test(process.env.WA_GRAPH_VERSION || '') ? process.env.WA_GRAPH_VERSION : 'v26.0';
  const consultas = [
    ['numero', `${PHONE_ID}?fields=id,display_phone_number,verified_name,quality_rating`],
    ['pertenencia', `${WABA_ID}/phone_numbers?fields=id,display_phone_number&limit=100`],
    ['suscripciones', `${WABA_ID}/subscribed_apps?limit=100`],
    ['plantillas', `${WABA_ID}/message_templates?fields=id,name,status,language&limit=100`]
  ];
  const resultados = await Promise.all(consultas.map(async ([nombre, ruta]) => {
    try {
      const response = await request(`https://graph.facebook.com/${version}/${ruta}`, {
        method: 'GET', headers: { Authorization: `Bearer ${token}` },
        redirect: 'error', signal: AbortSignal.timeout(10000)
      });
      const body = await response.json();
      // No devolver mensajes arbitrarios ni paging: podrían contener URLs con tokens.
      if (!response.ok || body.error) return [nombre, {ok:false, codigo: Number(body.error?.code)||response.status}];
      let datos;
      if (nombre === 'numero') datos = { id:body.id, numero:body.display_phone_number, nombre:body.verified_name, calidad:body.quality_rating };
      if (nombre === 'pertenencia') datos = {coincide:(body.data||[]).some(x=>x.id===PHONE_ID), parcial:!!body.paging?.next};
      if (nombre === 'plantillas') datos = {items:(body.data||[]).map(x=>({nombre:x.name,estado:x.status,idioma:x.language})), parcial:!!body.paging?.next};
      if (nombre === 'suscripciones') datos = {items:(body.data||[]).map(x=>({id:x.whatsapp_business_api_data?.id||x.id,nombre:x.whatsapp_business_api_data?.name||x.name, tieneOverride:!!x.override_callback_uri})), parcial:!!body.paging?.next};
      return [nombre,{ok:true,datos}];
    } catch { return [nombre,{ok:false,error:'Consulta no disponible; revisá conexión, permisos y vigencia del token.'}]; }
  }));
  return {soloLectura:true,phoneNumberId:PHONE_ID,wabaId:WABA_ID,resultados:Object.fromEntries(resultados)};
}
