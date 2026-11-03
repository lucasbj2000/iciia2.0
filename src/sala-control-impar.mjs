/* IMPAR · Sala de control en vivo.
   Foto del día por sucursal y pulsos en tiempo real. Los pulsos solo llevan la sucursal
   y el tipo de evento: nunca nombres, teléfonos ni contenido de clientes. */
import { q } from './db.mjs';
import { emitir } from './realtime.mjs';
import { alcanceSQL } from './auth.mjs';
import { sucursalDe } from './geografia-impar.mjs';

export const ROLES_SALA = ['admin', 'gerente', 'jefe'];
const HOY = "date_trunc('day', now() AT TIME ZONE 'America/Asuncion') AT TIME ZONE 'America/Asuncion'";
const TIPOS = new Set(['mensaje', 'nuevo', 'respuesta', 'venta']);

/* Destinatarios de los pulsos: quienes pueden abrir la sala (caché corta). */
const mandos = new Map();
async function uidsSala(empresaId) {
  const c = mandos.get(empresaId);
  if (c && c.hasta > Date.now()) return c.uids;
  const { rows } = await q(`SELECT id FROM usuarios WHERE activo AND
    (rol='admin' OR (empresa_id=$1 AND rol IN ('gerente','jefe')))`, [empresaId]);
  const uids = rows.map(x => x.id);
  mandos.set(empresaId, { uids, hasta: Date.now() + 60000 });
  return uids;
}

/** Nunca bloquea ni rompe el flujo que lo llama. */
export function pulsoSala(empresaId, negociacionId, tipo) {
  if (!empresaId || !negociacionId || !TIPOS.has(tipo)) return;
  (async () => {
    const [{ rows }, uids] = await Promise.all([
      q('SELECT sucursal FROM negociaciones WHERE id=$1 AND empresa_id=$2', [negociacionId, empresaId]),
      uidsSala(empresaId)
    ]);
    if (!rows[0] || !uids.length) return;
    emitir(empresaId, 'sala:pulso', { sucursal: rows[0].sucursal || '', tipo }, uids);
  })().catch(e => console.warn('[sala] Pulso omitido:', e.name));
}

/** «María González» → «María G.» para pantallas a la vista de todos. */
export const nombreCorto = n => {
  const p = String(n || '').trim().split(/\s+/).filter(Boolean);
  if (!p.length) return 'Cliente';
  return p.length > 1 ? `${p[0]} ${p[p.length - 1][0].toUpperCase()}.` : p[0];
};

export async function fotoSala(req, consulta = q) {
  const eid = req.empresaId;
  const { where, params } = await alcanceSQL(req.user, eid, 'n', 2);
  const equipoFiltro = req.user.rol === 'jefe' ? params[0] : null;
  const [sucursales, porSucursal, cola, tiempos, ritmo, equipo] = await Promise.all([
    consulta(`SELECT nombre,ciudad,lat,lon FROM sucursales WHERE empresa_id=$1 AND activa ORDER BY nombre`, [eid]),
    consulta(`SELECT COALESCE(NULLIF(n.sucursal,''),'') AS sucursal,
        COUNT(*) FILTER (WHERE n.etapa NOT IN ('ganado','cerrado'))::int AS abiertas,
        COUNT(*) FILTER (WHERE n.etapa='espera')::int AS espera,
        COUNT(*) FILTER (WHERE n.creado >= ${HOY})::int AS nuevos,
        COUNT(*) FILTER (WHERE n.etapa='ganado' AND n.actualizado >= ${HOY})::int AS ventas,
        COALESCE(SUM(COALESCE(NULLIF(n.monto_cierre,0),n.valor,0)) FILTER (WHERE n.etapa='ganado' AND n.actualizado >= ${HOY}),0)::float AS monto
       FROM negociaciones n WHERE n.empresa_id=$1
        AND (n.etapa NOT IN ('ganado','cerrado') OR n.actualizado >= ${HOY} OR n.creado >= ${HOY})${where}
       GROUP BY 1`, [eid, ...params]),
    consulta(`SELECT n.id,c.nombre AS cliente,u.nombre AS agente,n.sucursal,n.entrada_etapa
       FROM negociaciones n JOIN contactos c ON c.id=n.contacto_id LEFT JOIN usuarios u ON u.id=n.agente_id
       WHERE n.empresa_id=$1 AND n.etapa='espera'${where} ORDER BY n.entrada_etapa ASC LIMIT 8`, [eid, ...params]),
    consulta(`SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY seg)::float AS mediana, COUNT(*)::int AS n FROM (
         SELECT EXTRACT(EPOCH FROM (SELECT MIN(o.ts) FROM mensajes o WHERE o.empresa_id=$1 AND o.negociacion_id=p.nid
           AND o.dir='out' AND NOT o.bot AND NOT o.carga_historica AND o.ts > p.entra) - p.entra) AS seg
         FROM (SELECT m.negociacion_id AS nid, MIN(m.ts) AS entra FROM mensajes m JOIN negociaciones n ON n.id=m.negociacion_id
               WHERE m.empresa_id=$1 AND m.dir='in' AND NOT m.carga_historica AND m.ts >= ${HOY}${where} GROUP BY 1) p
       ) x WHERE seg IS NOT NULL`, [eid, ...params]),
    consulta(`SELECT EXTRACT(HOUR FROM m.ts AT TIME ZONE 'America/Asuncion')::int AS h,
        COUNT(*) FILTER (WHERE m.dir='in')::int AS entran,
        COUNT(*) FILTER (WHERE m.dir='out' AND NOT m.bot)::int AS responden
       FROM mensajes m JOIN negociaciones n ON n.id=m.negociacion_id
       WHERE m.empresa_id=$1 AND NOT m.carga_historica AND m.ts >= ${HOY}${where} GROUP BY 1 ORDER BY 1`, [eid, ...params]),
    consulta(`SELECT u.id,u.nombre,u.foto,u.disponibilidad,u.sucursal,
        (SELECT COUNT(*) FROM negociaciones n WHERE n.empresa_id=$1 AND n.agente_id=u.id AND n.etapa NOT IN ('ganado','cerrado'))::int AS carga,
        (SELECT COUNT(*) FROM mensajes m WHERE m.empresa_id=$1 AND m.autor_id=u.id AND m.dir='out' AND NOT m.bot AND m.ts >= ${HOY})::int AS respuestas
       FROM usuarios u WHERE u.empresa_id=$1 AND u.activo AND NOT u.oculto AND u.rol IN ('agente','jefe')
        AND ($2::uuid[] IS NULL OR u.id=ANY($2::uuid[]))
       ORDER BY u.nombre`, [eid, equipoFiltro])
  ]);
  return {
    generado: new Date().toISOString(),
    // Sucursales sin coordenadas cargadas toman la ubicación conocida de IMPAR.
    sucursales: sucursales.rows.map(s => {
      const g = s.lat == null || s.lon == null ? sucursalDe(s.nombre) : null;
      return { nombre: s.nombre, ciudad: s.ciudad, lat: s.lat ?? g?.lat ?? null, lon: s.lon ?? g?.lon ?? null };
    }),
    porSucursal: porSucursal.rows,
    cola: cola.rows.map(x => ({ id: x.id, cliente: nombreCorto(x.cliente), agente: x.agente ? nombreCorto(x.agente) : null,
      sucursal: x.sucursal || '', desde: x.entrada_etapa })),
    primeraRespuesta: { mediana: tiempos.rows[0]?.mediana ?? null, n: tiempos.rows[0]?.n || 0 },
    ritmo: ritmo.rows,
    equipo: equipo.rows.map(u => ({ id: u.id, nombre: u.nombre, foto: u.foto || null, disponibilidad: u.disponibilidad,
      sucursal: u.sucursal || '', carga: u.carga, respuestas: u.respuestas }))
  };
}
