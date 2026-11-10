/* IMPAR · Período de los reportes y tiempos de respuesta (bot y agentes).
   Un «turno» empieza cuando el cliente escribe después de una respuesta (o por primera vez).
   - Bot: tiempo hasta la primera respuesta automática, si llegó antes que la de una persona.
   - Agente: tiempo hasta la primera respuesta de una persona, contado en horario laboral
     (un mensaje de las 3 de la mañana no cuenta como 6 horas de demora). */

export const ZONA = 'America/Asuncion';
const DIA_MS = 86400000;
const MAX_DIAS = 1100;

/* ---------- Fechas en hora de Paraguay ---------- */
const partes = (fecha, opciones) => Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: ZONA, hourCycle: 'h23', ...opciones })
  .formatToParts(fecha).map(p => [p.type, p.value]));
const desfaseMin = fecha => {
  const z = partes(fecha, { timeZoneName: 'longOffset' }).timeZoneName || 'GMT';
  const m = z.match(/GMT([+-])(\d{2}):?(\d{2})?/);
  return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] || 0)) : 0;
};
/** Medianoche de un día YYYY-MM-DD en Paraguay, como instante. */
export function inicioDia(ymd) {
  const [y, mo, d] = ymd.split('-').map(Number);
  const guess = Date.UTC(y, mo - 1, d);
  return new Date(guess - desfaseMin(new Date(guess)) * 60000);
}
/** Fecha local YYYY-MM-DD de un instante. */
export function fechaLocal(instante) {
  const p = partes(new Date(instante), { year: 'numeric', month: '2-digit', day: '2-digit' });
  return `${p.year}-${p.month}-${p.day}`;
}
const esFecha = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) && !Number.isNaN(Date.parse(v + 'T00:00:00Z'));
const sumarDias = (ymd, n) => new Date(Date.parse(ymd + 'T00:00:00Z') + n * DIA_MS).toISOString().slice(0, 10);

/**
 * Período pedido: desde y hasta (YYYY-MM-DD, ambos incluidos). Compatible con ?dias=N (últimos N días).
 * Devuelve { desde, hasta, dias, ini, fin, iniAnt, finAnt } con ini/fin como instantes [ini, fin).
 */
export function rangoDesdeConsulta(query = {}, ahora = new Date()) {
  const hoy = fechaLocal(ahora);
  let desde, hasta;
  if (esFecha(query.desde) && esFecha(query.hasta)) { desde = query.desde; hasta = query.hasta; }
  else { const n = Math.min(Math.max(Number(query.dias) || 30, 1), MAX_DIAS); hasta = hoy; desde = sumarDias(hoy, -(n - 1)); }
  if (desde > hasta) [desde, hasta] = [hasta, desde];
  if (hasta > hoy) hasta = hoy < desde ? desde : hoy;
  let dias = Math.round((Date.parse(hasta) - Date.parse(desde)) / DIA_MS) + 1;
  if (dias > MAX_DIAS) { desde = sumarDias(hasta, -(MAX_DIAS - 1)); dias = MAX_DIAS; }
  const ini = inicioDia(desde), fin = inicioDia(sumarDias(hasta, 1));
  // Período anterior de la misma duración, para comparar.
  const iniAnt = inicioDia(sumarDias(desde, -dias));
  return { desde, hasta, dias, ini, fin, iniAnt, finAnt: ini };
}

/* ---------- Horario laboral, al minuto ---------- */
/** Minutos dentro del horario laboral entre dos instantes (reglas: diasHabiles 0-6, jornadaIni/Fin en horas). */
export function minutosLaborales(desde, hasta, reglas = {}) {
  const a = new Date(desde).getTime(), b = new Date(hasta).getTime();
  if (!(b > a)) return 0;
  const habiles = Array.isArray(reglas.diasHabiles) && reglas.diasHabiles.length ? reglas.diasHabiles : null;
  const ini = Number.isFinite(Number(reglas.jornadaIni)) ? Number(reglas.jornadaIni) : null;
  const fin = Number.isFinite(Number(reglas.jornadaFin)) ? Number(reglas.jornadaFin) : null;
  if (!habiles || ini == null || fin == null || fin <= ini) return (b - a) / 60000;
  let total = 0, dia = fechaLocal(a), vueltas = 0;
  const ultimo = fechaLocal(b);
  while (dia <= ultimo && vueltas++ < 40) {
    const cero = inicioDia(dia).getTime();
    const semana = new Date(Date.parse(dia + 'T12:00:00Z')).getUTCDay();
    if (habiles.includes(semana)) {
      const abre = cero + ini * 3600000, cierra = cero + fin * 3600000;
      total += Math.max(0, Math.min(b, cierra) - Math.max(a, abre));
    }
    dia = sumarDias(dia, 1);
  }
  return total / 60000;
}

/* ---------- Resúmenes ---------- */
export function resumir(valores, meta) {
  const v = valores.filter(Number.isFinite).sort((x, y) => x - y);
  const n = v.length;
  if (!n) return { n: 0, mediana: null, promedio: null, p90: null, indice: null };
  const q = p => { const i = (n - 1) * p, lo = Math.floor(i), hi = Math.ceil(i); return v[lo] + (v[hi] - v[lo]) * (i - lo); };
  return {
    n, mediana: q(0.5), promedio: v.reduce((s, x) => s + x, 0) / n, p90: q(0.9),
    // Índice de respuesta: % de turnos respondidos dentro de la meta.
    indice: Math.round(v.filter(x => x <= meta).length / n * 100)
  };
}

export function modoCubeta(dias) { return dias <= 31 ? 'dia' : dias <= 190 ? 'semana' : 'mes'; }
export function claveCubeta(ymd, modo, desde) {
  if (modo === 'dia') return ymd;
  if (modo === 'mes') return ymd.slice(0, 7);
  const n = Math.floor((Date.parse(ymd) - Date.parse(desde)) / DIA_MS / 7);
  return sumarDias(desde, n * 7);
}

/**
 * Turnos del período con su respuesta. `where`/`params` son el alcance de permisos sobre «n» (desde $4).
 * Devuelve el resumen del bot, de los agentes, por persona y la serie en el tiempo.
 */
export async function tiemposRespuesta(q, { empresaId, rango, where = '', params = [], reglas = {}, nombres = new Map() }) {
  const metaAgente = Math.max(1, Number(reglas.metaRespuestaMin) || 10); // minutos laborales
  const metaBot = 1; // minuto
  const { rows } = await q(
    `SELECT t.ts AS entra, r.bot_ts, r.ag_ts, r.autor
       FROM (SELECT m.negociacion_id, m.ts, m.dir,
                    lag(m.dir) OVER (PARTITION BY m.negociacion_id ORDER BY m.ts, m.id) AS previo
               FROM mensajes m JOIN negociaciones n ON n.id=m.negociacion_id AND n.empresa_id=m.empresa_id
              WHERE m.empresa_id=$1 AND m.ts >= $2::timestamptz - interval '2 days' AND m.ts < $3::timestamptz
                AND NOT m.carga_historica AND m.reemplazado_por IS NULL ${where}) t
       JOIN LATERAL (
            SELECT MIN(x.ts) FILTER (WHERE x.bot) AS bot_ts, MIN(x.ts) FILTER (WHERE NOT x.bot) AS ag_ts,
                   (array_agg(x.autor_id ORDER BY x.ts) FILTER (WHERE NOT x.bot AND x.autor_id IS NOT NULL))[1] AS autor
              FROM mensajes x
             WHERE x.empresa_id=$1 AND x.negociacion_id=t.negociacion_id AND x.dir='out'
               AND x.ts >= t.ts AND x.ts < t.ts + interval '15 days'
               AND NOT x.carga_historica AND x.reemplazado_por IS NULL) r ON TRUE
      WHERE t.dir='in' AND t.previo IS DISTINCT FROM 'in' AND t.ts >= $2::timestamptz AND t.ts < $3::timestamptz
      ORDER BY t.ts LIMIT 60000`,
    [empresaId, rango.ini.toISOString(), rango.fin.toISOString(), ...params]);

  const modo = modoCubeta(rango.dias);
  const bot = [], agente = [], porPersona = new Map(), serie = new Map();
  let sinRespuesta = 0, soloBot = 0;
  for (const t of rows) {
    const entra = new Date(t.entra);
    const clave = claveCubeta(fechaLocal(entra), modo, rango.desde);
    if (!serie.has(clave)) serie.set(clave, { bot: [], agente: [], turnos: 0 });
    const s = serie.get(clave); s.turnos++;
    if (t.bot_ts && (!t.ag_ts || new Date(t.bot_ts) <= new Date(t.ag_ts))) {
      const seg = (new Date(t.bot_ts) - entra) / 60000;
      bot.push(seg); s.bot.push(seg);
    }
    if (t.ag_ts) {
      const min = minutosLaborales(entra, t.ag_ts, reglas);
      agente.push(min); s.agente.push(min);
      const id = t.autor || 'telefono';
      if (!porPersona.has(id)) porPersona.set(id, []);
      porPersona.get(id).push(min);
    } else if (t.bot_ts) soloBot++;
    else sinRespuesta++;
  }
  const personas = [...porPersona].map(([id, v]) => ({
    id, nombre: id === 'telefono' ? 'Desde el teléfono' : (nombres.get(id) || 'Otra persona'), ...resumir(v, metaAgente)
  })).sort((a, b) => (a.mediana ?? 1e9) - (b.mediana ?? 1e9));
  return {
    metaAgenteMin: metaAgente, metaBotMin: metaBot, turnos: rows.length, recortado: rows.length >= 60000,
    sinRespuesta, soloBot, modo,
    bot: resumir(bot, metaBot), agente: resumir(agente, metaAgente), personas,
    serie: [...serie].sort((a, b) => a[0].localeCompare(b[0])).map(([clave, s]) => ({
      clave, turnos: s.turnos, bot: resumir(s.bot, metaBot).mediana, agente: resumir(s.agente, metaAgente).mediana
    }))
  };
}
