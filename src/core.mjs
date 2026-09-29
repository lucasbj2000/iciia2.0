import { q, telNorm } from './db.mjs';
import { emitir } from './realtime.mjs';
import * as ubi from './ubicaciones.mjs';

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
export const etapasActivas = emp => (emp.etapas || []).filter(e => e.activa).map(e => e.id);
export function etapaActiva(emp, id) { const e = (emp.etapas || []).find(x => x.id === id); return e ? !!e.activa : false; }
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
  if (!empresa.flags?.asignacionEquitativa) return null;
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
    `SELECT n.agente_id
       FROM negociaciones n
       JOIN usuarios u ON u.id=n.agente_id
      WHERE n.empresa_id=$1
        AND n.contacto_id=$2
        AND n.etapa = ANY($3)
        AND u.empresa_id=$1
        AND u.rol='agente'
        AND u.activo
        AND NOT u.oculto
      ORDER BY n.actualizado DESC, n.creado DESC
      LIMIT 1`,
    [empresa.id, contactoId, ['cerrado', 'ganado']]);
  return rows[0]?.agente_id || null;
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
  const t = telNorm(tel); if (!t) return null;
  const { rows } = await q(
    `SELECT n.* FROM negociaciones n JOIN contactos c ON c.id = n.contacto_id
      WHERE n.empresa_id=$1 AND c.tel_norm=$2 AND n.etapa = ANY($3)
        AND ($4::uuid IS NULL OR n.id <> $4) ORDER BY n.creado ASC LIMIT 1`,
    [empresa.id, t, etapasActivas(empresa), excluir]);
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
    const { rows } = await q('SELECT * FROM contactos WHERE empresa_id=$1 AND tel_norm=$2 LIMIT 1', [empresa.id, t]);
    if (rows[0]) return rows[0];
  }
  return null;
}

export async function crearContacto(empresa, d) {
  const suc = d.sucursal || (await sucursalPorDefecto(empresa));
  const { rows } = await q(
    `INSERT INTO contactos (empresa_id,nombre,tel,tel_norm,email,doc,ciudad,direccion,sucursal,linea,responsable_id,notas,externos)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [empresa.id, d.nombre, d.tel || '', telNorm(d.tel), d.email || '', d.doc || '', d.ciudad || '',
     d.direccion || '', suc, d.linea || (empresa.lineas || [])[0] || '', d.responsable_id || null,
     d.notas || '', JSON.stringify(d.externos || {})]);
  return rows[0];
}
async function sucursalPorDefecto(empresa) {
  const { rows } = await q('SELECT nombre FROM sucursales WHERE empresa_id=$1 AND activa ORDER BY nombre LIMIT 1', [empresa.id]);
  return rows[0]?.nombre || 'Central';
}

/* ================= INGESTA UNIFICADA ================= */
/** Punto único por donde entra TODO mensaje externo (los 4 canales). */
export async function ingresarMensaje(empresa, {
  canalId, canalSucursal, canalLinea, origen, extId, remitente, nombre, texto,
  mediaUrl, mediaTipo, mediaNombre, archivoId, ubicacion, ts, externoTipo
}) {
  if (extId) {
    const { rows } = await q('SELECT 1 FROM mensajes WHERE empresa_id=$1 AND msg_id=$2 LIMIT 1', [empresa.id, extId]);
    if (rows.length) return { duplicado: true };
  }
  const cuando = ts ? new Date(ts) : new Date();
  const telefonoWhatsApp = origen === 'whatsapp' && !String(remitente || '').includes('@')
    ? String(remitente)
    : null;

  /* --- contacto --- */
  let contacto = await buscarContacto(empresa, {
    tel: telefonoWhatsApp,
    externoTipo: externoTipo || origen, externoId: remitente
  });
  const reingreso = !!contacto;
  if (!contacto) {
    contacto = await crearContacto(empresa, {
      nombre: nombre || etiquetaAnonima(origen, remitente),
      tel: telefonoWhatsApp || '',
      sucursal: canalSucursal || null, linea: canalLinea || null,
      externos: { [externoTipo || origen]: String(remitente) }
    });
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
  const abierta = empresa.flags?.antiDuplicado ? await negActivaDeContacto(empresa, contacto.id) : null;

  if (abierta) {
    await q(
      `INSERT INTO mensajes (empresa_id,negociacion_id,dir,txt,media_url,media_tipo,media_nombre,archivo_id,ubicacion,msg_id,ts)
       VALUES ($1,$2,'in',$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING`,
      [empresa.id, abierta.id, texto || '', mediaUrl || null, mediaTipo || null, mediaNombre || null,
       archivoId || null, ubicacion ? JSON.stringify(ubicacion) : null, extId || null, cuando]);
    if (abierta.etapa !== 'espera') {
      await q(`UPDATE negociaciones SET etapa='espera', entrada_etapa=now(), actualizado=now(), aviso_sla=FALSE WHERE id=$1`, [abierta.id]);
      await historial(empresa.id, abierta.id, `Cliente respondió por ${origen} → Cliente espera una respuesta`, 'Sistema');
      await notificar(empresa, 'retorno', { cliente: contacto.nombre }, [abierta.agente_id], abierta.id);
    } else {
      await q('UPDATE negociaciones SET actualizado=now() WHERE id=$1', [abierta.id]);
    }
    if (det) await guardarUbicacion(empresa, contacto, abierta, det);
    emitir(empresa.id, 'neg:patch', { id: abierta.id });
    return { negociacionId: abierta.id, reusada: true, contacto };
  }

  /* --- negociación nueva --- */
  const responsableAnterior = reingreso
    ? await responsableUltimoCierre(empresa, contacto.id)
    : null;
  const agente = responsableAnterior
    || await asignarEquitativo(empresa, { sucursal: canalSucursal, linea: canalLinea });

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
       (empresa_id,contacto_id,titulo,etapa,origen,canal_id,agente_id,sucursal,linea,marcadores,bot_activo,creado,actualizado,entrada_etapa)
     VALUES ($1,$2,'Contacto entrante','nuevo',$3,$4,$5,$6,$7,$8,$9,$10,now(),now()) RETURNING *`,
    [empresa.id, contacto.id, origen, canalId || null, agente,
     canalSucursal || contacto.sucursal, canalLinea || contacto.linea,
     JSON.stringify(marcadores), !!(empresa.flags?.bot && empresa.bot?.activo), cuando]);
  const neg = rows[0];

  await q(
    `INSERT INTO mensajes (empresa_id,negociacion_id,dir,txt,media_url,media_tipo,media_nombre,archivo_id,ubicacion,msg_id,ts)
     VALUES ($1,$2,'in',$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING`,
    [empresa.id, neg.id, texto || '', mediaUrl || null, mediaTipo || null, mediaNombre || null,
     archivoId || null, ubicacion ? JSON.stringify(ubicacion) : null, extId || null, cuando]);

  if (empresa.flags?.bot && empresa.bot?.activo) {
    await q(`INSERT INTO mensajes (empresa_id,negociacion_id,dir,txt,bot,ts) VALUES ($1,$2,'out',$3,TRUE,now())`,
      [empresa.id, neg.id, String(empresa.bot.instrucciones || '').slice(0, 300)]);
  }
  await historial(empresa.id, neg.id,
    `Ingreso automático por ${origen}`
      + (responsableAnterior
        ? ' · conserva responsable de la última negociación cerrada'
        : (agente ? ' · asignado por reparto equitativo entre agentes activos' : ' · sin agentes activos disponibles')),
    'Bot');
  await notificar(empresa, 'nuevo', { cliente: contacto.nombre, origen }, [agente], neg.id);
  if (det) await guardarUbicacion(empresa, contacto, neg, det);
  emitir(empresa.id, 'neg:nueva', { id: neg.id });
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
export async function motorSLA() {
  const { rows: empresas } = await q('SELECT * FROM empresas WHERE activa');
  for (const emp of empresas) {
    const r = emp.reglas || {};
    const { rows: negs } = await q(
      `SELECT n.*, c.nombre AS cliente FROM negociaciones n JOIN contactos c ON c.id=n.contacto_id
        WHERE n.empresa_id=$1 AND n.etapa='contactado'`, [emp.id]);
    for (const n of negs) {
      const h = horasLaborales(n.entrada_etapa, new Date(), r);
      if (emp.flags?.autoCierre && h >= (r.slaHoras || 24)) {
        await q(`UPDATE negociaciones SET etapa='cerrado', motivo='Sin retorno',
                   actualizado=now(), entrada_etapa=now(), aviso_sla=FALSE WHERE id=$1`, [n.id]);
        await historial(emp.id, n.id, `Cierre automático por ${r.slaHoras}h laborales sin retorno`, 'Sistema');
        await notificar(emp, 'autocierre', { cliente: n.cliente }, [n.agente_id], n.id);
        emitir(emp.id, 'neg:patch', { id: n.id });
      } else if (!n.aviso_sla && h >= (r.slaHoras || 24) * ((r.avisoSlaPct || 70) / 100)) {
        await q('UPDATE negociaciones SET aviso_sla=TRUE WHERE id=$1', [n.id]);
        await notificar(emp, 'sla', { cliente: n.cliente, tiempo: `${h.toFixed(1)}h` }, [n.agente_id], n.id);
      }
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
