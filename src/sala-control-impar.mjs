/* IMPAR · Sala de control en vivo.
   Foto del día por sucursal y pulsos en tiempo real. Los pulsos solo llevan la sucursal
   y el tipo de evento: nunca nombres, teléfonos ni contenido de clientes. */
import { q } from './db.mjs';
import { emitir, uidsConectados } from './realtime.mjs';
import { alcanceSQL } from './auth.mjs';
import { sucursalDe, detectarCiudad } from './geografia-impar.mjs';

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
  let t = String(n || '').trim();
  // Nombres escritos todo en mayúsculas se muestran con mayúscula inicial.
  if (/\p{Lu}/u.test(t) && !/\p{Ll}/u.test(t)) t = t.toLocaleLowerCase('es').replace(/[\p{L}\p{M}]+/gu, w => w.charAt(0).toLocaleUpperCase('es') + w.slice(1));
  const p = t.split(/\s+/).filter(Boolean);
  if (!p.length) return 'Cliente';
  return p.length > 1 ? `${p[0]} ${p[p.length - 1][0].toUpperCase()}.` : p[0];
};

/** Agrupa clientes en celdas de ~11 km (0,1°): la sala nunca recibe ubicaciones individuales. */
export function zonasDeCalor(filas) {
  const celdas = new Map();
  let ubicados = 0;
  for (const f of filas) {
    let lat = f.lat, lon = f.lon;
    if (lat == null || lon == null) { const c = f.ciudad ? detectarCiudad(f.ciudad) : null; if (!c) continue; lat = c.lat; lon = c.lon; }
    if (lat < -28.5 || lat > -19 || lon < -63 || lon > -54) continue; // fuera de Paraguay
    const k = `${(Math.round(lat * 10) / 10).toFixed(1)},${(Math.round(lon * 10) / 10).toFixed(1)}`;
    celdas.set(k, (celdas.get(k) || 0) + f.n); ubicados += f.n;
  }
  const zonas = [...celdas].map(([k, n]) => { const [lat, lon] = k.split(',').map(Number); return { lat, lon, n }; })
    .sort((a, b) => b.n - a.n).slice(0, 150);
  return { zonas, ubicados };
}

/* Clima de cada sucursal en una sola consulta a Open-Meteo; se guarda 10 minutos. */
const climas = new Map();
export async function climaSucursales(req, consulta = q) {
  const c = climas.get(req.empresaId);
  if (c && c.hasta > Date.now()) return c.datos;
  const { rows } = await consulta(`SELECT nombre,lat,lon FROM sucursales WHERE empresa_id=$1 AND activa ORDER BY nombre`, [req.empresaId]);
  const lista = rows.map(s => { const g = s.lat == null ? sucursalDe(s.nombre) : null; return { nombre: s.nombre, lat: s.lat ?? g?.lat, lon: s.lon ?? g?.lon }; })
    .filter(s => s.lat != null && s.lon != null);
  if (!lista.length) return [];
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lista.map(s => s.lat.toFixed(3)).join(',')}`
    + `&longitude=${lista.map(s => s.lon.toFixed(3)).join(',')}&current=temperature_2m,weather_code&timezone=America%2FAsuncion`;
  const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
  if (!r.ok) throw new Error('clima ' + r.status);
  const j = await r.json(), arr = Array.isArray(j) ? j : [j];
  const datos = lista.map((s, i) => ({ nombre: s.nombre, temp: arr[i]?.current?.temperature_2m ?? null, cod: arr[i]?.current?.weather_code ?? null }));
  climas.set(req.empresaId, { datos, hasta: Date.now() + 600000 });
  return datos;
}

export async function fotoSala(req, consulta = q) {
  const eid = req.empresaId;
  const { where, params } = await alcanceSQL(req.user, eid, 'n', 2);
  const equipoFiltro = req.user.rol === 'jefe' ? params[0] : null;
  const [sucursales, porSucursal, cola, tiempos, ritmo, equipo, ubicados] = await Promise.all([
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
    consulta(`SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY seg)::float AS mediana,
        COUNT(seg)::int AS n, COUNT(*)::int AS total FROM (
         SELECT EXTRACT(EPOCH FROM (SELECT MIN(o.ts) FROM mensajes o WHERE o.empresa_id=$1 AND o.negociacion_id=p.nid
           AND o.dir='out' AND NOT o.bot AND NOT o.carga_historica AND o.ts > p.entra) - p.entra) AS seg
         FROM (SELECT m.negociacion_id AS nid, MIN(m.ts) AS entra FROM mensajes m JOIN negociaciones n ON n.id=m.negociacion_id
               WHERE m.empresa_id=$1 AND m.dir='in' AND NOT m.carga_historica AND m.ts >= ${HOY}${where} GROUP BY 1) p
       ) x`, [eid, ...params]),
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
       ORDER BY u.nombre`, [eid, equipoFiltro]),
    // Mapa de calor: clientes de los últimos 90 días con ubicación conocida o ciudad informada.
    consulta(`SELECT COALESCE(c.lat, ub.lat) AS lat, COALESCE(c.lon, ub.lon) AS lon, NULLIF(c.ciudad,'') AS ciudad, COUNT(*)::int AS n
       FROM (SELECT DISTINCT n.contacto_id FROM negociaciones n
             WHERE n.empresa_id=$1 AND n.actualizado >= now() - interval '90 days'${where}) x
       JOIN contactos c ON c.id=x.contacto_id
       LEFT JOIN LATERAL (SELECT u.lat,u.lon FROM ubicaciones u WHERE u.contacto_id=c.id AND u.lat IS NOT NULL
                          ORDER BY u.ts DESC LIMIT 1) ub ON TRUE
       GROUP BY 1,2,3`, [eid, ...params])
  ]);
  const enLinea = uidsConectados(eid);
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
    primeraRespuesta: { mediana: tiempos.rows[0]?.mediana ?? null, n: tiempos.rows[0]?.n || 0, total: tiempos.rows[0]?.total || 0 },
    calor: zonasDeCalor(ubicados.rows),
    ritmo: ritmo.rows,
    equipo: equipo.rows.map(u => ({ id: u.id, nombre: u.nombre, foto: u.foto || null, disponibilidad: u.disponibilidad,
      sucursal: u.sucursal || '', carga: u.carga, respuestas: u.respuestas, enLinea: enLinea.has(u.id) }))
  };
}
