/**
 * Campañas masivas de IMPAR por WhatsApp Cloud API (número verificado).
 *
 * - Solo plantillas APROBADAS por Meta: a un cliente que no escribió en las últimas 24 h
 *   no se le puede mandar texto libre.
 * - Respeta un límite diario de destinatarios por línea (Meta empieza en 250 por día).
 * - Quien responde «BAJA» no vuelve a recibir campañas.
 * - Los estados (enviado, entregado, leído, fallido) llegan por el webhook de Meta.
 * Nunca registra tokens ni el contenido de los mensajes en los logs.
 */
import { q, tx } from './db.mjs';
import { resolverToken } from './meta-secretos-impar.mjs';
import { historial } from './core.mjs';

const WA_API = `https://graph.facebook.com/${process.env.WA_GRAPH_VERSION || 'v26.0'}`;
export const LOTE = 20;               // mensajes por vuelta del motor (cada 4 s ≈ 5 por segundo)
export const MAX_DESTINOS = 20000;    // por campaña
const PAUSA_ENTRE_ENVIOS = 150;

/* ================= Permisos ================= */
/** Admin siempre; gerentes salvo que se les quite; el resto solo si se les da acceso. */
export async function tieneAccesoCampanas(usuario, empresaId) {
  if (!usuario) return false;
  if (usuario.rol === 'admin') return true;
  const { rows } = await q('SELECT permitido FROM campanas_accesos WHERE empresa_id=$1 AND usuario_id=$2', [empresaId, usuario.id]);
  if (rows.length) return rows[0].permitido === true;
  return usuario.rol === 'gerente';
}

export async function listarPermisos(empresaId) {
  const { rows } = await q(
    `SELECT u.id,u.nombre,u.rol,u.sucursal,a.permitido
       FROM usuarios u LEFT JOIN campanas_accesos a ON a.usuario_id=u.id AND a.empresa_id=u.empresa_id
      WHERE u.empresa_id=$1 AND u.activo AND NOT coalesce(u.oculto,false)
      ORDER BY (u.rol='admin') DESC,(u.rol='gerente') DESC,u.nombre`, [empresaId]);
  return rows.map(u => ({
    id: u.id, nombre: u.nombre, rol: u.rol, sucursal: u.sucursal,
    acceso: u.rol === 'admin' ? true : u.permitido ?? (u.rol === 'gerente'),
    fijo: u.rol === 'admin',
    porDefecto: u.rol !== 'admin' && u.permitido == null
  }));
}

/* ================= Teléfonos ================= */
/** Deja el número en formato internacional sin «+» (595981123456). null si no es válido. */
export function normalizarTelefono(valor, prefijo = process.env.PREFIJO_PAIS || '595') {
  let n = String(valor ?? '').replace(/\D/g, '');
  if (n.startsWith('00')) n = n.slice(2);
  if (!n) return null;
  if (!n.startsWith(prefijo)) {
    if (n.startsWith('0')) n = prefijo + n.slice(1);
    else if (n.length <= 10) n = prefijo + n;
  }
  return n.length >= 11 && n.length <= 15 ? n : null;
}

/* ================= Plantillas ================= */
const VAR = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;
const variablesDe = texto => [...new Set([...String(texto || '').matchAll(VAR)].map(m => m[1]))];

/** Convierte una plantilla de Meta al formato que usa IMPAR, indicando si se puede enviar. */
export function resumirPlantilla(t) {
  const comps = t.components || [];
  const enc = comps.find(c => c.type === 'HEADER'), cuerpo = comps.find(c => c.type === 'BODY');
  const pie = comps.find(c => c.type === 'FOOTER'), botones = comps.find(c => c.type === 'BUTTONS')?.buttons || [];
  const motivos = [];
  if (enc && !['TEXT', 'IMAGE', 'VIDEO', 'DOCUMENT'].includes(enc.format)) motivos.push('encabezado de ubicación');
  for (const b of botones) {
    if (b.type === 'URL' && VAR.test(b.url || '')) motivos.push('botón con enlace variable');
    VAR.lastIndex = 0;
    if (['COPY_CODE', 'FLOW', 'CATALOG', 'MPM', 'OTP', 'SPM'].includes(b.type)) motivos.push(`botón ${b.type.toLowerCase()}`);
  }
  return {
    nombre: t.name, idioma: t.language, categoria: t.category, estado: t.status,
    nombrado: t.parameter_format === 'NAMED',
    encabezado: enc ? { formato: enc.format, texto: enc.text || '', variables: enc.format === 'TEXT' ? variablesDe(enc.text) : [] } : null,
    cuerpo: { texto: cuerpo?.text || '', variables: variablesDe(cuerpo?.text) },
    pie: pie?.text || '',
    botones: botones.map(b => ({ tipo: b.type, texto: b.text })),
    soportada: !motivos.length,
    motivo: motivos.length ? `IMPAR todavía no envía plantillas con ${[...new Set(motivos)].join(', ')}.` : ''
  };
}

async function graph(canal, ruta, opciones = {}) {
  const token = resolverToken(canal.config?.token);
  if (!token) throw Object.assign(new Error('El canal no tiene token de Meta.'), { status: 409 });
  const r = await fetch(`${WA_API}/${ruta}`, {
    ...opciones,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(opciones.headers || {}) }
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) {
    const e = new Error(j.error?.message || `Meta respondió ${r.status}`);
    e.codigo = j.error?.code; e.detalle = j.error?.error_data?.details;
    throw e;
  }
  return j;
}

export async function leerPlantillas(canal) {
  const waba = canal.config?.waba_id;
  if (!waba) throw Object.assign(new Error('El canal no tiene cargado el ID de la cuenta de mensajes (WABA ID).'), { status: 409 });
  const lista = [];
  let ruta = `${waba}/message_templates?fields=name,language,status,category,components,parameter_format&limit=200`;
  for (let i = 0; i < 5 && ruta; i++) {
    const j = await graph(canal, ruta);
    lista.push(...(j.data || []));
    ruta = j.paging?.next ? j.paging.next.replace(`${WA_API}/`, '') : null;
  }
  return lista.filter(t => t.status === 'APPROVED').map(resumirPlantilla)
    .sort((a, b) => a.nombre.localeCompare(b.nombre));
}

/* ================= Variables ================= */
const limpiar = v => String(v ?? '').replace(/[\r\n\t]+/g, ' ').replace(/ {4,}/g, '   ').trim().slice(0, 1000);
const primerNombre = n => {
  const p = limpiar(n).split(/\s+/)[0] || '';
  return p ? p[0].toLocaleUpperCase('es') + p.slice(1).toLocaleLowerCase('es') : '';
};
/** Valor de una variable para un destinatario: nombre, nombre completo, columna del archivo o texto fijo. */
export function valorVariable(def = {}, destino = {}) {
  let v = '';
  if (def.fuente === 'nombre') v = primerNombre(destino.nombre);
  else if (def.fuente === 'nombre_completo') v = limpiar(destino.nombre);
  else if (def.fuente === 'columna') v = limpiar(destino.datos?.[def.columna]);
  else v = limpiar(def.valor);
  return v || limpiar(def.respaldo) || (def.fuente?.startsWith('nombre') ? 'cliente' : '');
}

/** Componentes del mensaje para la API de Meta. */
export function componentesEnvio(plantilla, variables = {}, destino = {}) {
  const comps = [], param = (clave, texto) => plantilla.nombrado
    ? { type: 'text', parameter_name: clave, text: texto } : { type: 'text', text: texto };
  const enc = plantilla.encabezado;
  if (enc?.formato === 'TEXT' && enc.variables.length) {
    comps.push({ type: 'header', parameters: enc.variables.map(k => param(k, valorVariable(variables.encabezado?.[k], destino))) });
  } else if (enc && ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(enc.formato)) {
    const tipo = enc.formato.toLowerCase();
    comps.push({ type: 'header', parameters: [{ type: tipo, [tipo]: { link: variables.media } }] });
  }
  if (plantilla.cuerpo.variables.length) {
    comps.push({ type: 'body', parameters: plantilla.cuerpo.variables.map(k => param(k, valorVariable(variables.cuerpo?.[k], destino))) });
  }
  return comps;
}

/** Texto final, para la vista previa. */
export function textoFinal(plantilla, variables = {}, destino = {}) {
  const rellenar = (texto, defs) => String(texto || '').replace(VAR, (_, k) => valorVariable(defs?.[k], destino) || `{{${k}}}`);
  return {
    encabezado: plantilla.encabezado?.formato === 'TEXT' ? rellenar(plantilla.encabezado.texto, variables.encabezado) : '',
    cuerpo: rellenar(plantilla.cuerpo.texto, variables.cuerpo),
    pie: plantilla.pie
  };
}

/** Revisa que todas las variables tengan de dónde salir antes de crear la campaña. */
export function validarVariables(plantilla, variables = {}) {
  const faltan = [];
  const revisar = (lista, defs, lugar) => {
    for (const k of lista) {
      const d = defs?.[k];
      if (!d || !d.fuente) faltan.push(`${lugar} {{${k}}}`);
      else if (d.fuente === 'fijo' && !limpiar(d.valor)) faltan.push(`${lugar} {{${k}}} (texto vacío)`);
      else if (d.fuente === 'columna' && !d.columna) faltan.push(`${lugar} {{${k}}} (falta la columna)`);
    }
  };
  if (plantilla.encabezado?.formato === 'TEXT') revisar(plantilla.encabezado.variables, variables.encabezado, 'Encabezado');
  revisar(plantilla.cuerpo.variables, variables.cuerpo, 'Mensaje');
  if (plantilla.encabezado && ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(plantilla.encabezado.formato)
      && !/^https:\/\/\S+$/.test(String(variables.media || ''))) faltan.push('enlace público (https) del archivo del encabezado');
  return faltan;
}

/* ================= Errores de Meta ================= */
const ERRORES = {
  131026: 'El número no tiene WhatsApp o no pudo recibir el mensaje',
  131049: 'Meta no lo entregó para cuidar la experiencia del cliente (límite de mensajes de marketing por persona)',
  131050: 'El cliente eligió no recibir mensajes de marketing de empresas',
  131021: 'El destinatario es el mismo número que envía',
  131000: 'Error de Meta al enviar; se puede reintentar más tarde',
  131053: 'No se pudo usar el archivo del encabezado',
  132000: 'La cantidad de variables no coincide con la plantilla',
  132001: 'La plantilla no existe en ese idioma o todavía no está aprobada',
  132005: 'El texto con variables quedó demasiado largo',
  132007: 'El contenido no cumple las políticas de Meta',
  132012: 'El formato de las variables no coincide con la plantilla',
  132015: 'La plantilla está pausada por baja calidad',
  132016: 'La plantilla fue desactivada por baja calidad',
  131042: 'Hay un problema con el método de pago de la cuenta de mensajes',
  131031: 'La cuenta de WhatsApp está bloqueada',
  131048: 'Meta limitó los envíos por posible spam',
  131056: 'Demasiados mensajes seguidos al mismo número',
  130429: 'Se superó la velocidad de envío de Meta',
  368: 'Meta bloqueó temporalmente los envíos de esta cuenta',
  190: 'El token del canal venció o fue revocado',
  200: 'El token no tiene permiso sobre esta cuenta',
  10: 'El token no tiene permiso sobre esta cuenta'
};
const PAUSAN = new Set([190, 200, 10, 368, 131031, 131042, 131048, 132000, 132001, 132012, 132015, 132016, 131053]);
const ESPERAN = new Set([130429, 131056, 131000]);
export const explicarError = (codigo, mensaje) => ERRORES[codigo] || String(mensaje || 'Meta no aceptó el envío').slice(0, 200);
export const clasificarError = codigo => PAUSAN.has(Number(codigo)) ? 'pausar' : ESPERAN.has(Number(codigo)) ? 'esperar' : 'fallido';

/* ================= Motor de envío ================= */
const dormir = ms => new Promise(r => setTimeout(r, ms));

export async function enviadosUltimas24h(canalId) {
  const { rows: [r] } = await q(
    `SELECT count(DISTINCT d.telefono)::int AS n FROM campana_destinos d JOIN campanas c ON c.id=d.campana_id
      WHERE c.canal_id=$1 AND d.enviado > now() - interval '24 hours'`, [canalId]);
  return r.n;
}

async function enviarPlantilla(canal, plantilla, variables, destino) {
  const j = await graph(canal, `${canal.config.phone_number_id}/messages`, {
    method: 'POST',
    body: JSON.stringify({
      messaging_product: 'whatsapp', to: destino.telefono, type: 'template',
      template: { name: plantilla.nombre, language: { code: plantilla.idioma }, components: componentesEnvio(plantilla, variables, destino) }
    })
  });
  return j.messages?.[0]?.id || null;
}

async function pausar(campana, motivo) {
  await q("UPDATE campanas SET estado='pausada',error=$2 WHERE id=$1 AND estado='enviando'", [campana.id, motivo]);
  console.warn('[campañas] pausada', campana.id, motivo);
}

async function procesarCampana(c, enviar) {
  if (!c.canal_activo || c.canal_tipo !== 'whatsapp_api')
    return pausar(c, 'El canal de Cloud API está inactivo: activalo para que las respuestas lleguen a IMPAR.');
  const usados = await enviadosUltimas24h(c.canal_id);
  const disponible = Math.min(LOTE, c.limite_diario - usados);
  if (disponible <= 0) {
    await q("UPDATE campanas SET error=$2 WHERE id=$1 AND estado='enviando'",
      [c.id, `Límite diario alcanzado (${usados}/${c.limite_diario}). Sigue sola cuando se libere.`]);
    return;
  }
  const { rows: lote } = await q(
    "SELECT id,telefono,nombre,datos FROM campana_destinos WHERE campana_id=$1 AND estado='pendiente' ORDER BY id LIMIT $2",
    [c.id, disponible]);
  if (!lote.length) {
    await q("UPDATE campanas SET estado='terminada',terminado=now(),error=NULL WHERE id=$1 AND estado='enviando'", [c.id]);
    return;
  }
  const { rows: bajas } = await q('SELECT telefono FROM campanas_bajas WHERE empresa_id=$1 AND telefono=ANY($2)',
    [c.empresa_id, lote.map(d => d.telefono)]);
  const deBaja = new Set(bajas.map(b => b.telefono));
  await q("UPDATE campanas SET error=NULL WHERE id=$1 AND error LIKE 'Límite diario%'", [c.id]);
  for (const d of lote) {
    const { rows: [vigente] } = await q('SELECT estado FROM campanas WHERE id=$1', [c.id]);
    if (vigente?.estado !== 'enviando') return;
    if (deBaja.has(d.telefono)) {
      await q("UPDATE campana_destinos SET estado='omitido',error='Pidió no recibir campañas',actualizado=now() WHERE id=$1", [d.id]);
      continue;
    }
    try {
      const waId = await enviar(c, d);
      await q("UPDATE campana_destinos SET estado='enviado',wa_id=$2,enviado=now(),error=NULL,actualizado=now() WHERE id=$1 AND estado='pendiente'",
        [d.id, waId]);
    } catch (e) {
      const accion = clasificarError(e.codigo);
      if (accion === 'pausar') return pausar(c, explicarError(e.codigo, e.message));
      if (accion === 'esperar') return;
      // Un rechazo no ocupa lugar en el tope diario: no se marca «enviado».
      await q("UPDATE campana_destinos SET estado='fallido',error=$2,actualizado=now() WHERE id=$1",
        [d.id, explicarError(e.codigo, e.message)]);
    }
    await dormir(PAUSA_ENTRE_ENVIOS);
  }
}

let ocupado = false;
/** Una vuelta del motor: la llama el worker cada pocos segundos. */
export async function procesarCampanas({ enviar } = {}) {
  if (ocupado) return;
  ocupado = true;
  try {
    const { rows } = await q(
      `SELECT c.*,ca.config,ca.activo AS canal_activo,ca.tipo AS canal_tipo
         FROM campanas c JOIN canales ca ON ca.id=c.canal_id
        WHERE c.estado='enviando' ORDER BY c.iniciado NULLS LAST`);
    for (const c of rows) {
      const fn = enviar || ((camp, d) => enviarPlantilla({ config: camp.config }, camp.plantilla, camp.variables, d));
      await procesarCampana(c, fn).catch(e => console.error('[campañas]', c.id, e.name));
    }
  } finally { ocupado = false; }
}

/* ================= Estados y respuestas ================= */
/** Acuse de Meta (sent/delivered/read/failed) para un mensaje de campaña. Devuelve true si era de campaña. */
export async function registrarEstadoCampana(waId, status, codigoError) {
  if (!waId) return false;
  const nuevo = { sent: 'enviado', delivered: 'entregado', read: 'leido', failed: 'fallido' }[status];
  if (!nuevo) return false;
  const { rowCount } = await q(
    `UPDATE campana_destinos SET
       estado = CASE WHEN $2='fallido' THEN 'fallido'
                     WHEN array_position(ARRAY['pendiente','enviado','entregado','leido'],$2) >
                          coalesce(array_position(ARRAY['pendiente','enviado','entregado','leido'],estado),0) THEN $2
                     ELSE estado END,
       error = CASE WHEN $2='fallido' THEN $3 ELSE error END,
       actualizado = now()
     WHERE wa_id=$1`, [String(waId), nuevo, nuevo === 'fallido' ? explicarError(codigoError) : null]);
  return rowCount > 0;
}

const PIDE_BAJA = /^(baja|stop|parar|desuscribir(me)?|cancelar suscripcion|no (quiero|deseo) (recibir )?(mas )?(mensajes|promociones|publicidad|campanas))[.!¡ ]*$/;
export const pideBaja = texto => PIDE_BAJA.test(String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim());

/** Mensaje entrante por Cloud API: registra bajas y marca la respuesta a la campaña en el Historial. */
export async function registrarRespuestaCampana(empresa, remitente, texto, negociacionId) {
  const tel = normalizarTelefono(remitente);
  if (!tel || !empresa?.id) return;
  if (pideBaja(texto)) {
    await q("INSERT INTO campanas_bajas(empresa_id,telefono,origen) VALUES($1,$2,'cliente') ON CONFLICT DO NOTHING", [empresa.id, tel]);
    if (negociacionId) await historial(empresa.id, negociacionId, 'El cliente pidió no recibir más campañas (BAJA)', 'Sistema');
  }
  const { rows: [d] } = await q(
    `UPDATE campana_destinos d SET respondio=now()
       FROM campanas c
      WHERE d.id = (SELECT id FROM campana_destinos WHERE empresa_id=$1 AND telefono=$2 AND respondio IS NULL
                      AND enviado > now() - interval '7 days' ORDER BY enviado DESC LIMIT 1)
        AND c.id=d.campana_id
      RETURNING c.nombre`, [empresa.id, tel]);
  if (d && negociacionId) await historial(empresa.id, negociacionId, `Respondió a la campaña «${d.nombre}»`, 'Sistema');
}

/* ================= Destinatarios ================= */
/** Filtros de contactos del sistema (búsqueda, sucursal, ciudad, etapa de su última negociación). */
export function filtroContactos(empresaId, f = {}) {
  const p = [empresaId], w = ["c.empresa_id=$1", "coalesce(c.tel,'')<>''"];
  const agregar = (cond, val) => { p.push(val); w.push(cond.replaceAll('?', `$${p.length}`)); };
  if (f.texto) agregar('(c.nombre ILIKE ? OR c.tel ILIKE ?)', `%${String(f.texto).slice(0, 80)}%`);
  if (f.sucursal) agregar('c.sucursal = ?', String(f.sucursal));
  if (f.ciudad) agregar('c.ciudad ILIKE ?', String(f.ciudad));
  if (f.etapa) agregar('n.etapa = ?', String(f.etapa));
  return {
    desde: `FROM contactos c LEFT JOIN LATERAL (
              SELECT etapa FROM negociaciones WHERE contacto_id=c.id AND empresa_id=c.empresa_id ORDER BY creado DESC LIMIT 1) n ON true
            WHERE ${w.join(' AND ')}`,
    params: p
  };
}

/** Une contactos elegidos, filtros y lista cargada; normaliza, quita repetidos y marca las bajas. */
export async function prepararDestinos(empresaId, { contactos = [], filtros = null, lista = [] } = {}) {
  const porTel = new Map(), invalidos = [];
  const sumar = (tel, nombre, datos, contactoId) => {
    const t = normalizarTelefono(tel);
    if (!t) { invalidos.push(String(tel ?? '').slice(0, 30)); return; }
    const previo = porTel.get(t), nom = limpiar(nombre).slice(0, 120) || null;
    // Mismo número en el sistema y en el archivo: se combinan (las columnas del archivo sirven para las variables).
    if (previo) { Object.assign(previo.datos, datos || {}); previo.nombre ||= nom; previo.contacto_id ||= contactoId || null; return; }
    porTel.set(t, { telefono: t, nombre: nom, datos: { ...(datos || {}) }, contacto_id: contactoId || null });
  };
  const ids = [...new Set((Array.isArray(contactos) ? contactos : []).map(String))].slice(0, MAX_DESTINOS);
  if (ids.length) {
    const { rows } = await q("SELECT id,nombre,tel FROM contactos WHERE empresa_id=$1 AND id = ANY($2::uuid[]) AND coalesce(tel,'')<>''", [empresaId, ids]);
    for (const c of rows) sumar(c.tel, c.nombre, {}, c.id);
  }
  if (filtros) {
    const f = filtroContactos(empresaId, filtros);
    const { rows } = await q(`SELECT c.id,c.nombre,c.tel ${f.desde} ORDER BY c.nombre LIMIT ${MAX_DESTINOS}`, f.params);
    for (const c of rows) sumar(c.tel, c.nombre, {}, c.id);
  }
  for (const fila of (Array.isArray(lista) ? lista : []).slice(0, MAX_DESTINOS)) {
    const datos = {};
    for (const [k, v] of Object.entries(fila?.datos || {}).slice(0, 20)) datos[String(k).slice(0, 40)] = limpiar(v).slice(0, 300);
    sumar(fila?.telefono, fila?.nombre, datos, null);
  }
  const destinos = [...porTel.values()].slice(0, MAX_DESTINOS);
  const { rows: bajas } = destinos.length
    ? await q('SELECT telefono FROM campanas_bajas WHERE empresa_id=$1 AND telefono = ANY($2)', [empresaId, destinos.map(d => d.telefono)])
    : { rows: [] };
  const deBaja = new Set(bajas.map(b => b.telefono));
  return { destinos, invalidos, bajas: destinos.filter(d => deBaja.has(d.telefono)).length, deBaja };
}

export async function crearCampana({ empresaId, usuarioId, canal, nombre, plantilla, variables, limiteDiario, destinos, deBaja }) {
  return tx(async c => {
    const { rows: [camp] } = await c.query(
      `INSERT INTO campanas(empresa_id,canal_id,nombre,plantilla,variables,limite_diario,creado_por)
       VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [empresaId, canal.id, nombre, plantilla, variables, limiteDiario, usuarioId]);
    for (let i = 0; i < destinos.length; i += 1000) {
      const parte = destinos.slice(i, i + 1000);
      await c.query(
        `INSERT INTO campana_destinos(campana_id,empresa_id,telefono,nombre,contacto_id,datos,estado,error)
         SELECT $1,$2,t.tel,t.nom,t.cid,t.dat,t.est,t.err
           FROM unnest($3::text[],$4::text[],$5::uuid[],$6::jsonb[],$7::text[],$8::text[]) AS t(tel,nom,cid,dat,est,err)
         ON CONFLICT DO NOTHING`,
        [camp.id, empresaId, parte.map(d => d.telefono), parte.map(d => d.nombre), parte.map(d => d.contacto_id),
         parte.map(d => JSON.stringify(d.datos || {})),
         parte.map(d => deBaja?.has(d.telefono) ? 'omitido' : 'pendiente'),
         parte.map(d => deBaja?.has(d.telefono) ? 'Pidió no recibir campañas' : null)]);
    }
    return camp.id;
  });
}

export async function resumenCampana(id, empresaId) {
  const { rows: [c] } = await q(
    `SELECT c.id,c.nombre,c.estado,c.plantilla,c.variables,c.limite_diario,c.creado,c.iniciado,c.terminado,c.error,c.canal_id,
            ca.nombre AS canal_nombre,u.nombre AS creado_por_nombre,
            count(d.id)::int AS total,
            count(d.id) FILTER (WHERE d.estado='pendiente')::int AS pendientes,
            count(d.id) FILTER (WHERE d.estado IN ('enviado','entregado','leido'))::int AS enviados,
            count(d.id) FILTER (WHERE d.estado IN ('entregado','leido'))::int AS entregados,
            count(d.id) FILTER (WHERE d.estado='leido')::int AS leidos,
            count(d.id) FILTER (WHERE d.estado='fallido')::int AS fallidos,
            count(d.id) FILTER (WHERE d.estado='omitido')::int AS omitidos,
            count(d.respondio)::int AS respondieron
       FROM campanas c LEFT JOIN canales ca ON ca.id=c.canal_id LEFT JOIN usuarios u ON u.id=c.creado_por
       LEFT JOIN campana_destinos d ON d.campana_id=c.id
      WHERE c.id=$1 AND c.empresa_id=$2 GROUP BY c.id,ca.nombre,u.nombre`, [id, empresaId]);
  return c || null;
}
