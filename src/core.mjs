import { q, tx, telNorm } from './db.mjs';
import { buscarPorTelefono } from './telefonos-impar.mjs';
import { emitir } from './realtime.mjs';
import { pulsoSala } from './sala-control-impar.mjs';
import * as ubi from './ubicaciones.mjs';
import { programarBot } from './bot.mjs';
import { resolverCitaEntrante } from './citas-impar.mjs';
import { leerEnlace } from './enlaces-agentes-impar.mjs';
import { detectarNumeroEnRedes } from './redes-a-whatsapp-impar.mjs';

/* ================= NOTIFICACIONES ================= */
export async function destinatarios(empresa, dest, base = []) {
  if (dest === 'destinatario') return base.filter(Boolean);
  const set = new Set(base.filter(Boolean));
  const roles = [];
  if (dest.includes('jefe')) roles.push('jefe');
  if (dest.includes('gerente')) roles.push('gerente');
  if (dest === 'agente+jefe+gerente') roles.push('agente', 'jefe', 'gerente');
  if (roles.length) {
    const { rows } = await q('SELECT id FROM usuarios WHERE empresa_id=$1 AND activo AND rol = ANY($2)', [empresa.id, roles]);
    rows.forEach(r => set.add(r.id));
  }
  if (dest.includes('admin')) {
    const { rows } = await q("SELECT id FROM usuarios WHERE rol='admin' AND activo");
    rows.forEach(r => set.add(r.id));
  }
  return [...set];
}

export async function notificar(empresa, tipo, vars = {}, base = [], ref = null) {
  if (!empresa || !empresa.flags?.notificaciones) return;
  const regla = (empresa.notis || []).find(x => x.k === tipo);
  if (!regla || !regla.v) return;
  let msg = regla.msg;
  for (const [k, v] of Object.entries(vars)) msg = msg.split(`{${k}}`).join(v ?? '—');
  if (vars.mensajeCompleto) msg = vars.mensajeCompleto; // avisos agrupados con su propia frase
  const uids = await destinatarios(empresa, regla.dest, base);
  if (!uids.length) return;
  await q(
    `INSERT INTO notificaciones (empresa_id,usuario_id,tipo,titulo,msg,tono,ref)
     SELECT $1, u, $2,$3,$4,$5,$6 FROM unnest($7::uuid[]) AS u`,
    [empresa.id, tipo, regla.t, msg, regla.tono, ref, uids]);
  emitir(empresa.id, 'noti', { tipo, titulo: regla.t, msg, tono: regla.tono, ref }, uids);
}

export const auditar = (empresaId, usuario, accion, detalle, ip) =>
  q('INSERT INTO auditoria (empresa_id,usuario,accion,detalle,ip) VALUES ($1,$2,$3,$4,$5)',
    [empresaId, usuario, accion, detalle || '', ip || null]);

export const historial = (empresaId, negId, txt, por) =>
  q('INSERT INTO historial (empresa_id,negociacion_id,txt,por) VALUES ($1,$2,$3,$4)',
    [empresaId, negId, txt, por || 'Sistema']);

/* ================= ETAPAS / SLA ================= */
export const ETAPAS_TERMINALES = new Set(['ganado', 'cerrado']);
export const esEtapaTerminal = id => ETAPAS_TERMINALES.has(String(id || ''));

export const etapasActivas = emp => (emp.etapas || [])
  .filter(e => e.activa && !esEtapaTerminal(e.id))
  .map(e => e.id);

export function etapaActiva(emp, id) {
  if (esEtapaTerminal(id)) return false;
  const e = (emp.etapas || []).find(x => x.id === id);
  return e ? !!e.activa : false;
}
export function nombreEtapa(emp, id) { const e = (emp.etapas || []).find(x => x.id === id); return e ? e.nombre : id; }

export function horasLaborales(desde, hasta, r) {
  let ms = 0, cur = new Date(desde); const fin = new Date(hasta); let guard = 0;
  while (cur < fin && guard++ < 9000) {
    const d = cur.getDay(), h = cur.getHours();
    if ((r.diasHabiles || []).includes(d) && h >= r.jornadaIni && h < r.jornadaFin) ms += 3600000;
    cur = new Date(cur.getTime() + 3600000);
  }
  return ms / 3600000;
}

/* ================= ASIGNACIÓN ================= */
/**
 * Reparte nuevas negociaciones sólo entre agentes activos y visibles.
 * Se prioriza la menor cantidad de negociaciones abiertas; si hay empate,
 * recibe la siguiente quien lleva más tiempo sin una asignación.
 *
 * La disponibilidad operativa no interviene en este reparto: el campo
 * usuarios.activo es la fuente de verdad para participar o no.
 */
export async function asignarEquitativo(empresa, { sucursal, linea } = {}) {
  const activas = etapasActivas(empresa);

  const buscar = async (suc, lin) => {
    const cond = ['u.empresa_id=$1', "u.rol='agente'", 'u.activo', 'NOT u.oculto'];
    const params = [empresa.id, activas];
    if (suc) { params.push(suc); cond.push(`u.sucursal = $${params.length}`); }
    if (lin) { params.push(lin); cond.push(`u.linea = $${params.length}`); }

    const { rows } = await q(
      `SELECT u.id,
              COUNT(n.id) FILTER (WHERE n.etapa = ANY($2))::int AS carga,
              MAX(n.creado) AS ultima_asignacion
         FROM usuarios u
         LEFT JOIN negociaciones n
           ON n.empresa_id=u.empresa_id AND n.agente_id=u.id
        WHERE ${cond.join(' AND ')}
        GROUP BY u.id, u.nombre
        ORDER BY carga ASC, ultima_asignacion ASC NULLS FIRST, u.nombre ASC
        LIMIT 1`, params);
    return rows[0]?.id || null;
  };

  if (empresa.flags?.asignarPorSucursal && sucursal) {
    return (await buscar(sucursal, linea))
      || (await buscar(sucursal, null))
      || (await buscar(null, null));
  }
  return buscar(null, null);
}

/**
 * Un cliente que vuelve luego de una negociación cerrada o ganada conserva
 * al último responsable, siempre que ese agente siga activo.
 */
export async function responsableUltimoCierre(empresa, contactoId) {
  const { rows } = await q(
    `SELECT n.agente_id, u.activo, u.oculto
       FROM negociaciones n
       LEFT JOIN usuarios u
         ON u.id=n.agente_id AND u.empresa_id=n.empresa_id
      WHERE n.empresa_id=$1
        AND n.contacto_id=$2
        AND n.etapa = ANY($3)
      ORDER BY n.actualizado DESC, n.creado DESC
      LIMIT 1`,
    [empresa.id, contactoId, ['cerrado', 'ganado']]);

  const ultimo = rows[0];
  return ultimo?.agente_id && ultimo.activo && !ultimo.oculto
    ? ultimo.agente_id
    : null;
}

/* ================= ANTI DUPLICADO ================= */
export async function negActivaDeContacto(empresa, contactoId, excluir = null) {
  const { rows } = await q(
    `SELECT * FROM negociaciones WHERE empresa_id=$1 AND contacto_id=$2 AND etapa = ANY($3)
       AND ($4::uuid IS NULL OR id <> $4) ORDER BY creado ASC LIMIT 1`,
    [empresa.id, contactoId, etapasActivas(empresa), excluir]);
  return rows[0] || null;
}
export async function negActivaPorTel(empresa, tel, excluir = null) {
  const c = await buscarPorTelefono({query:q},empresa.id,tel);
  if (!c) return null;
  const { rows } = await q(
    `SELECT * FROM negociaciones n
      WHERE n.empresa_id=$1 AND n.contacto_id=$2 AND n.etapa = ANY($3)
        AND ($4::uuid IS NULL OR n.id <> $4) ORDER BY n.creado ASC LIMIT 1`,
    [empresa.id, c.id, etapasActivas(empresa), excluir]);
  return rows[0] || null;
}

/* ================= CONTACTOS ================= */
export async function buscarContacto(empresa, { tel, externoTipo, externoId }) {
  if (externoTipo && externoId) {
    const externo = String(externoId);
    const { rows } = await q(
      `SELECT * FROM contactos WHERE empresa_id=$1 AND externos->>$2 = $3 LIMIT 1`,
      [empresa.id, externoTipo, externo]);
    if (rows[0]) return rows[0];
    // Ficha unificada: el @lid quedó anotado aparte porque «whatsapp» guarda el número.
    if (externoTipo === 'whatsapp' && externo.endsWith('@lid')) {
      const { rows: unificadas } = await q(
        `SELECT * FROM contactos WHERE empresa_id=$1 AND externos->>'whatsapp_lid' = $2 LIMIT 1`,
        [empresa.id, externo]);
      if (unificadas[0]) return unificadas[0];
    }

    // Compatibilidad con contactos creados antes de preservar el sufijo @lid.
    if (externoTipo === 'whatsapp' && externo.endsWith('@lid')) {
      const legado = externo.split('@')[0];
      const { rows: antiguos } = await q(
        `SELECT * FROM contactos WHERE empresa_id=$1 AND externos->>'whatsapp'=$2 LIMIT 1`,
        [empresa.id, legado]);
      if (antiguos[0]) return antiguos[0];
    }
  }
  const t = telNorm(tel);
  if (t) {
    const hallado=await buscarPorTelefono({query:q},empresa.id,t);
    if(hallado)return hallado;
  }
  return null;
}

export async function crearContacto(empresa,d,{devolverCreacion=false}={}) {
  const resultado=(contacto,creado)=>devolverCreacion?{contacto,creado}:contacto;
  const suc=d.sucursal||(await sucursalPorDefecto(empresa));
  const tel=String(d.tel||'');
  const clave=telNorm(tel);
  const digitos=tel.replace(/\D/g,'');
  return tx(async db=>{
    // Impedir dos altas concurrentes del mismo número en IMPAR.
    if(clave){
      await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',[empresa.id+':'+clave]);
      const {rows:existentes}=await db.query(
        'SELECT DISTINCT c.* FROM contactos c '+
        'LEFT JOIN contacto_telefonos t ON t.contacto_id=c.id AND t.empresa_id=c.empresa_id '+
        'WHERE c.empresa_id=$1 AND (c.tel_norm=$2 OR t.tel_norm=$2) LIMIT 2',
        [empresa.id,clave]);
      if(existentes.length>1)
        throw Object.assign(new Error('Este teléfono coincide con varios contactos existentes. Revisar antes de crear otra ficha.'),{status:409});
      if(existentes.length===1)return resultado(existentes[0],false);
    }
    // Sin teléfono (Messenger, Instagram, WhatsApp por @lid): una sola ficha por identidad,
    // aunque lleguen dos mensajes al mismo tiempo.
    const [tipoExt,idExt]=Object.entries(d.externos||{}).find(([,v])=>v)||[];
    if(!clave && tipoExt){
      await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',[empresa.id+':ext:'+tipoExt+':'+idExt]);
      const {rows:mismos}=await db.query(
        'SELECT * FROM contactos WHERE empresa_id=$1 AND (externos->>$2=$3 OR ($2=$4 AND externos->>$5=$3)) LIMIT 1',
        [empresa.id,tipoExt,String(idExt),'whatsapp','whatsapp_lid']);
      if(mismos[0])return resultado(mismos[0],false);
    }
    const {rows}=await db.query(
      `INSERT INTO contactos (empresa_id,nombre,tel,tel_norm,email,doc,ciudad,direccion,sucursal,linea,responsable_id,notas,externos)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [empresa.id,d.nombre,tel,clave,d.email||'',d.doc||'',d.ciudad||'',
       d.direccion||'',suc,d.linea||(empresa.lineas||[])[0]||'',
       d.responsable_id||null,d.notas||'',JSON.stringify(d.externos||{})]);
    // Registrar la identidad primaria sólo si es un número internacional válido.
    if(digitos.length>=10 && digitos.length<=15 && clave.length===8){
      await db.query(
        'INSERT INTO contacto_telefonos (empresa_id,contacto_id,numero,tel_norm,etiqueta) '+
        "VALUES($1,$2,$3,$4,'Principal') ON CONFLICT(empresa_id,tel_norm) DO NOTHING",
        [empresa.id,rows[0].id,tel,clave]);
    }
    return resultado(rows[0],true);
  });
}
async function sucursalPorDefecto(empresa) {
  const { rows } = await q('SELECT nombre FROM sucursales WHERE empresa_id=$1 AND activa ORDER BY nombre LIMIT 1', [empresa.id]);
  return rows[0]?.nombre || 'Central';
}

/* ================= INGESTA UNIFICADA ================= */
/** Punto único por donde entra TODO mensaje externo (los 4 canales). */
export async function ingresarMensaje(empresa, datos) {
  let r;
  try { r = await ingresarMensajeUnico(empresa, datos); }
  catch (e) {
    // Dos mensajes del mismo cliente al mismo tiempo: el segundo va a la negociación que abrió el primero.
    if (e?.code === '23505' && /idx_neg_activa_unica/.test(String(e.constraint || e.message))) r = await ingresarMensajeUnico(empresa, datos);
    else throw e;
  }
  // Cliente de Messenger/Instagram que pasó su número: la conversación sigue por WhatsApp en la misma ficha.
  if (r?.negociacionId && !r.informativo && datos?.texto && (datos.origen === 'messenger' || datos.origen === 'instagram')) {
    const v = await detectarNumeroEnRedes(empresa, { origen: datos.origen, texto: datos.texto, negociacionId: r.negociacionId })
      .catch(e => { console.warn('[redes→whatsapp] No se pudo vincular el número:', e.status ? e.message : (e.code || e.name)); return null; });
    if (v) r = { ...r, negociacionId: v.negociacionId, pasoAWhatsApp: true };
  }
  return r;
}
async function ingresarMensajeUnico(empresa, {
  canalId, canalSucursal, canalLinea, origen, extId, remitente, nombre, texto,
  mediaUrl, mediaTipo, mediaNombre, archivoId, ubicacion, ts, externoTipo, cita, editado,
  especial = null, anuncio = null
}) {
  // Ver src/contenido-whatsapp-impar.mjs: reacciones y avisos de WhatsApp no mueven la negociación.
  if (!['reaccion', 'sistema', 'llamada', 'no_admitido'].includes(especial)) especial = null;
  const informativo = especial === 'reaccion' || especial === 'sistema';
  if (extId) {
    const { rows } = await q('SELECT 1 FROM mensajes WHERE empresa_id=$1 AND msg_id=$2 LIMIT 1', [empresa.id, extId]);
    if (rows.length) return { duplicado: true };
  }
  const cuando = ts ? new Date(ts) : new Date();
  // Una cita que no se pueda vincular nunca impide registrar el mensaje.
  const citaFinal = cita ? await resolverCitaEntrante(q, empresa.id, cita)
    .catch(e => { console.warn('[citas] Vínculo no resuelto:', e.name); return null; }) : null;
  const citaJSON = citaFinal ? JSON.stringify(citaFinal) : null;
  const editadoJSON = editado && typeof editado === 'object' ? JSON.stringify(editado) : null;
  // Enlace de WhatsApp del agente: el cliente queda con quien le envió el enlace.
  let enlace = null;
  if (origen === 'whatsapp' && texto) {
    const leido = await leerEnlace(q, empresa.id, texto)
      .catch(e => { console.warn('[enlaces] No se pudo leer el enlace:', e.name); return null; });
    if (leido) { texto = leido.texto; enlace = leido.agente; }
  }
  const telefonoWhatsApp = origen === 'whatsapp' && !String(remitente || '').includes('@')
    ? String(remitente)
    : null;

  /* --- contacto --- */
  let contacto = await buscarContacto(empresa, {
    tel: telefonoWhatsApp,
    externoTipo: externoTipo || origen, externoId: remitente
  });
  let reingreso = !!contacto;
  if (!contacto) {
    const alta = await crearContacto(empresa, {
      nombre: nombre || etiquetaAnonima(origen, remitente),
      tel: telefonoWhatsApp || '',
      sucursal: canalSucursal || null, linea: canalLinea || null,
      externos: { [externoTipo || origen]: String(remitente) }
    },{devolverCreacion:true});
    contacto=alta.contacto;
    reingreso=!alta.creado;
  } else {
    const ext = contacto.externos || {};
    const key = externoTipo || origen;
    if (!ext[key] || (origen === 'whatsapp' && String(remitente).includes('@') && ext[key] !== String(remitente))) {
      ext[key] = String(remitente);
      await q('UPDATE contactos SET externos=$2 WHERE id=$1', [contacto.id, JSON.stringify(ext)]);
    }
    if (nombre && /^(WhatsApp|Messenger|Instagram|Contacto) /.test(contacto.nombre)) {
      await q('UPDATE contactos SET nombre=$2 WHERE id=$1', [contacto.id, nombre]);
      contacto.nombre = nombre;
    }
  }

  /* --- reacción o aviso de WhatsApp: se guarda en la conversación del cliente sin moverla ---
     No pasa a «Cliente espera respuesta», no avisa al agente, no despierta al bot y no abre
     una negociación nueva: va a la abierta o, si no hay, a la última que tuvo. */
  if (informativo) {
    // Primero la conversación del mensaje al que reaccionó; si no se conoce, la abierta o la última.
    const delCitado = citaFinal?.id ? (await q('SELECT negociacion_id AS id FROM mensajes WHERE id=$1 AND empresa_id=$2',
      [citaFinal.id, empresa.id])).rows[0] : null;
    const destino = (delCitado?.id ? delCitado : null) || await negActivaDeContacto(empresa, contacto.id)
      || (await q('SELECT id FROM negociaciones WHERE empresa_id=$1 AND contacto_id=$2 ORDER BY actualizado DESC LIMIT 1',
        [empresa.id, contacto.id])).rows[0];
    if (!destino) return { informativo: true, sinNegociacion: true, contacto };
    await q(
      `INSERT INTO mensajes (empresa_id,negociacion_id,dir,txt,msg_id,ts,remitente_numero,cita,canal_id,especial)
       VALUES ($1,$2,'in',$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,
      [empresa.id, destino.id, texto || '', extId || null, cuando, telefonoWhatsApp || null, citaJSON, canalId || null, especial]);
    emitir(empresa.id, 'neg:patch', { id: destino.id });
    return { negociacionId: destino.id, informativo: true, contacto };
  }

  /* --- detección de ubicación --- */
  let det = null;
  if (empresa.flags?.detectarUbicacion) {
    if (ubicacion?.lat != null) {
      det = { fuente: 'gps', confianza: 'alta', lat: ubicacion.lat, lon: ubicacion.lon,
        texto: ubicacion.nombre || ubicacion.direccion || '', direccion: ubicacion.direccion || '' };
    } else if (texto) {
      det = ubi.detectar(texto);
    }
  }

  /* --- ¿ya tiene una negociación abierta? --- */
  const abierta = await negActivaDeContacto(empresa, contacto.id); // anti duplicado siempre activo

  if (abierta) {
    if (enlace && abierta.agente_id !== enlace.id) {
      await q(`UPDATE negociaciones SET agente_id=$3, enlace_agente_id=$3, bot_activo=FALSE,
                 sucursal=COALESCE((SELECT NULLIF(sucursal,'') FROM usuarios WHERE id=$3 AND empresa_id=$2), sucursal)
               WHERE id=$1 AND empresa_id=$2`, [abierta.id, empresa.id, enlace.id]);
      await q('UPDATE contactos SET responsable_id=$3 WHERE id=$1 AND empresa_id=$2', [contacto.id, empresa.id, enlace.id]);
      await historial(empresa.id, abierta.id, `🔗 Asignado a ${enlace.nombre} por su enlace de WhatsApp`, 'Sistema');
      await notificar(empresa, 'transfer', { origenUsr: 'Tu enlace de WhatsApp', cliente: contacto.nombre }, [enlace.id], abierta.id);
      abierta.agente_id = enlace.id;
      contacto.responsable_id = enlace.id;
    }
    await q(
      `INSERT INTO mensajes (empresa_id,negociacion_id,dir,txt,media_url,media_tipo,media_nombre,archivo_id,ubicacion,msg_id,ts,remitente_numero,cita,editado,canal_id,especial)
       VALUES ($1,$2,'in',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) ON CONFLICT DO NOTHING`,
      [empresa.id, abierta.id, texto || '', mediaUrl || null, mediaTipo || null, mediaNombre || null,
       archivoId || null, ubicacion ? JSON.stringify(ubicacion) : null, extId || null, cuando,
      telefonoWhatsApp || null, citaJSON, editadoJSON, canalId || null, especial]);
    if (anuncio) await historial(empresa.id, abierta.id, anuncio, 'Sistema');
    // Si el cliente escribió por otra línea (otro número de WhatsApp, Cloud API, Messenger…),
    // la negociación pasa a ese canal: el agente responde desde el mismo número al que le escribieron.
    // Excepción: si la conversación ya pasó a WhatsApp y el cliente vuelve a escribir por redes,
    // el mensaje queda en el chat pero las respuestas siguen saliendo por WhatsApp.
    const sigueEnWhatsApp = (origen === 'messenger' || origen === 'instagram') && contacto.tel_norm && abierta.canal_id
      && (await q('SELECT tipo FROM canales WHERE id=$1', [abierta.canal_id])).rows[0]?.tipo?.startsWith('whatsapp');
    if (canalId && abierta.canal_id !== canalId && !sigueEnWhatsApp) {
      const { rows: [nuevo] } = await q('SELECT nombre FROM canales WHERE id=$1 AND empresa_id=$2', [canalId, empresa.id]);
      if (nuevo) {
        await q('UPDATE negociaciones SET canal_id=$3 WHERE id=$1 AND empresa_id=$2', [abierta.id, empresa.id, canalId]);
        await historial(empresa.id, abierta.id, `El cliente escribió por «${nuevo.nombre}»: las respuestas salen por esa línea`, 'Sistema');
        abierta.canal_id = canalId;
      }
    }
    // El número al que se responde es el último número que escribió en esta
    // negociación; no sobrescribir el teléfono principal del cliente.
    if(origen==='whatsapp' && telefonoWhatsApp){
      await q('UPDATE negociaciones SET telefono_destino=$3 WHERE id=$1 AND empresa_id=$2',
        [abierta.id,empresa.id,telefonoWhatsApp]);
    }
    if (abierta.etapa !== 'espera') {
      await q(`UPDATE negociaciones SET etapa='espera', entrada_etapa=now(), actualizado=now(), aviso_sla=FALSE WHERE id=$1`, [abierta.id]);
      await historial(empresa.id, abierta.id, `Cliente respondió por ${origen} → Cliente espera una respuesta`, 'Sistema');
      await notificar(empresa, 'retorno', { cliente: contacto.nombre }, [abierta.agente_id], abierta.id);
    } else {
      await q('UPDATE negociaciones SET actualizado=now() WHERE id=$1', [abierta.id]);
    }
    if (det) await guardarUbicacion(empresa, contacto, abierta, det);
    emitir(empresa.id, 'neg:patch', { id: abierta.id });
    pulsoSala(empresa.id, abierta.id, 'mensaje');
    if (empresa.flags?.bot && empresa.bot?.activo) programarBot(empresa,abierta.id);
    return { negociacionId: abierta.id, reusada: true, contacto };
  }

  /* --- negociación nueva --- */
  const { rows: responsables } = contacto.responsable_id ? await q(
    'SELECT id,sucursal FROM usuarios WHERE id=$1 AND empresa_id=$2 AND activo AND NOT oculto',
    [contacto.responsable_id,empresa.id]) : { rows: [] };
  const responsableAnterior = responsables[0]?.id || (reingreso
    ? await responsableUltimoCierre(empresa, contacto.id) : null);
  const esImpar = empresa.codigo === 'impar';
  const recepcionImpar = !!(!enlace && esImpar && !reingreso && !contacto.responsable_id && !responsableAnterior
    && empresa.flags?.bot && empresa.bot?.activo && empresa.bot?.recepcionImpar !== false);
  const agente = enlace?.id || responsableAnterior || (recepcionImpar ? null
    : await asignarEquitativo(empresa, { sucursal: canalSucursal, linea: canalLinea }));
  const { rows: owner } = agente ? await q('SELECT sucursal FROM usuarios WHERE id=$1 AND empresa_id=$2',[agente,empresa.id]) : { rows: [] };

  if (agente && contacto.responsable_id !== agente) {
    await q('UPDATE contactos SET responsable_id=$2 WHERE id=$1 AND empresa_id=$3',
      [contacto.id, agente, empresa.id]);
    contacto.responsable_id = agente;
  }

  const marcadores = [];
  if (reingreso && empresa.flags?.marcadorFrecuente) {
    marcadores.push('frecuente');
    await q('UPDATE contactos SET frecuente=TRUE WHERE id=$1', [contacto.id]);
  }
  const { rows } = await q(
    `INSERT INTO negociaciones
       (empresa_id,contacto_id,titulo,etapa,origen,canal_id,agente_id,sucursal,linea,marcadores,bot_activo,creado,actualizado,entrada_etapa,telefono_destino,bot_recepcion)
     VALUES ($1,$2,'Contacto entrante','nuevo',$3,$4,$5,$6,$7,$8,$9,$10,now(),now(),$11,$12) RETURNING *`,
    [empresa.id, contacto.id, origen, canalId || null, agente,
     owner[0]?.sucursal || canalSucursal || contacto.sucursal, canalLinea || contacto.linea,
     JSON.stringify(marcadores), esImpar ? recepcionImpar : !!(empresa.flags?.bot && empresa.bot?.activo), cuando,
     origen==='whatsapp'?telefonoWhatsApp:null,
     JSON.stringify(recepcionImpar?{elegible:true,version:2}:{})]);
  const neg = rows[0];

  await q(
    `INSERT INTO mensajes (empresa_id,negociacion_id,dir,txt,media_url,media_tipo,media_nombre,archivo_id,ubicacion,msg_id,ts,remitente_numero,cita,editado,canal_id,especial)
     VALUES ($1,$2,'in',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) ON CONFLICT DO NOTHING`,
    [empresa.id, neg.id, texto || '', mediaUrl || null, mediaTipo || null, mediaNombre || null,
     archivoId || null, ubicacion ? JSON.stringify(ubicacion) : null, extId || null, cuando,
      telefonoWhatsApp || null, citaJSON, editadoJSON, canalId || null, especial]);
  if (anuncio) await historial(empresa.id, neg.id, anuncio, 'Sistema');

  if (empresa.flags?.bot && empresa.bot?.activo) programarBot(empresa,neg.id);
  await historial(empresa.id, neg.id,
    `Ingreso automático por ${origen}`
      + (enlace ? ' · asignado por enlace de WhatsApp del agente'
        : responsableAnterior
        ? ' · conserva responsable de la última negociación cerrada'
        : (agente ? ' · asignado por reparto equitativo entre agentes activos' : recepcionImpar ? ' · recepción pendiente de elección de sucursal' : ' · sin agentes activos disponibles')),
    'Bot');
  if (enlace) {
    await q('UPDATE negociaciones SET enlace_agente_id=$3 WHERE id=$1 AND empresa_id=$2', [neg.id, empresa.id, enlace.id]);
    await historial(empresa.id, neg.id, `🔗 Asignado a ${enlace.nombre} por su enlace de WhatsApp`, 'Sistema');
  }
  await notificar(empresa, 'nuevo', { cliente: contacto.nombre, origen }, [agente], neg.id);
  if (det) await guardarUbicacion(empresa, contacto, neg, det);
  emitir(empresa.id, 'neg:nueva', { id: neg.id });
  pulsoSala(empresa.id, neg.id, 'nuevo');
  return { negociacionId: neg.id, contacto };
}

async function guardarUbicacion(empresa, contacto, neg, det) {
  try {
    const u = await ubi.registrar(empresa, { contactoId: contacto.id, negociacionId: neg.id, det });
    if (u) {
      await historial(empresa.id, neg.id,
        `📍 Ubicación detectada (${u.fuente}): ${u.direccion || u.texto}`, 'Sistema');
      await notificar(empresa, 'ubicacion',
        { cliente: contacto.nombre, direccion: u.direccion || u.texto }, [neg.agente_id], neg.id);
      emitir(empresa.id, 'ubicacion', { negociacionId: neg.id, contactoId: contacto.id });
    }
  } catch (e) { console.error('[ubicacion]', e.message); }
}

function etiquetaAnonima(origen, id) {
  const cola = String(id || '').slice(-4);
  return `${({ whatsapp: 'WhatsApp', facebook: 'Messenger', instagram: 'Instagram' })[origen] || 'Contacto'} ${cola}`;
}

/* ================= MOTOR SLA ================= */
/* «Contactado» sin retorno: si el cliente no contesta en sinRetornoHoras horas corridas (24 por defecto),
   la negociación se cierra sola como «Sin retorno» para que no se acumulen en esa columna.
   El plazo cuenta desde lo último que pasó: la entrada a «Contactado» o el último mensaje enviado al
   cliente (un seguimiento del agente le vuelve a dar 24 h). Si el cliente responde, pasa a
   «Cliente espera respuesta» y deja de contar. Las reacciones no cuentan como retorno. */
export const SIN_RETORNO_SQL = `
  SELECT n.id, n.agente_id, n.entrada_etapa, c.nombre AS cliente, n.aviso_sla,
         GREATEST(n.entrada_etapa, COALESCE((SELECT MAX(m.ts) FROM mensajes m
           WHERE m.negociacion_id=n.id AND m.empresa_id=n.empresa_id AND m.dir='out' AND NOT m.carga_historica), n.entrada_etapa)) AS desde
    FROM negociaciones n JOIN contactos c ON c.id=n.contacto_id
   WHERE n.empresa_id=$1 AND n.etapa='contactado'`;
export async function motorSLA() {
  const { rows: empresas } = await q('SELECT * FROM empresas WHERE activa');
  for (const emp of empresas) {
    const r = emp.reglas || {};
    const horas = Math.max(1, Number(r.sinRetornoHoras) || 24);
    const { rows: negs } = await q(SIN_RETORNO_SQL, [emp.id]);
    const cerradas = new Map(); // agente -> clientes cerrados en esta vuelta
    for (const n of negs) {
      const h = (Date.now() - new Date(n.desde).getTime()) / 3600000;
      if (emp.flags?.autoCierre && h >= horas) {
        // Solo si sigue en «Contactado» (el cliente pudo haber respondido mientras tanto).
        const { rowCount } = await q(`UPDATE negociaciones SET etapa='cerrado', motivo='Sin retorno',
                   actualizado=now(), entrada_etapa=now(), aviso_sla=FALSE WHERE id=$1 AND etapa='contactado'`, [n.id]);
        if (!rowCount) continue;
        await historial(emp.id, n.id, `Cierre automático: el cliente no respondió en ${horas} h → Cerrado · Sin retorno`, 'Sistema');
        emitir(emp.id, 'neg:patch', { id: n.id });
        const k = n.agente_id || '';
        if (!cerradas.has(k)) cerradas.set(k, []);
        cerradas.get(k).push(n);
      } else if (emp.flags?.autoCierre && !n.aviso_sla && h >= horas * ((r.avisoSlaPct || 70) / 100)) {
        await q('UPDATE negociaciones SET aviso_sla=TRUE WHERE id=$1', [n.id]);
        await notificar(emp, 'sla', { cliente: n.cliente, tiempo: `${Math.floor(h)} h sin respuesta del cliente` }, [n.agente_id], n.id);
      }
    }
    // Avisos: uno por negociación si son pocas; si se cerraron muchas juntas (las acumuladas), uno solo por agente.
    for (const [agente, lista] of cerradas) {
      if (lista.length <= 3) for (const n of lista) await notificar(emp, 'autocierre', { cliente: n.cliente }, agente ? [agente] : [], n.id);
      else await notificar(emp, 'autocierre', { mensajeCompleto: `Se cerraron ${lista.length} negociaciones en «Contactado» porque los clientes no respondieron en ${horas} h.` }, agente ? [agente] : [], null);
    }
  }
}

export async function avisarCumples() {
  const { rows: empresas } = await q('SELECT * FROM empresas WHERE activa');
  for (const emp of empresas) {
    if (!emp.flags?.calendario || !emp.flags?.cumpleAviso || !emp.flags?.cumpleanos) continue;
    const { rows } = await q(
      `SELECT nombre FROM usuarios WHERE empresa_id=$1 AND activo AND nacimiento IS NOT NULL
         AND to_char(nacimiento,'MM-DD') = to_char(now(),'MM-DD')`, [emp.id]);
    for (const p of rows) await notificar(emp, 'cumple', { persona: p.nombre }, []);
  }
}

