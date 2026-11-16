/**
 * IMPAR · Tiempos por estado de los asesores (Disponible, En gestión, Almuerzo, Permiso) y salidas sin marcar.
 *
 * Cada cambio de estado queda en «marcaciones». El tiempo de un estado va desde su marcación hasta la
 * siguiente, cortado al final de ese día (hora de Paraguay): si alguien no marca la salida, su estado no
 * sigue sumando horas durante la noche. Al día siguiente el CRM le pide la hora aproximada y el motivo,
 * y guarda esa salida como «olvido».
 */
import { q } from './db.mjs';
import { fechaLocal, inicioDia } from './tiempos-respuesta-impar.mjs';

export const TRABAJO = ['disponible', 'ocupado', 'almuerzo', 'permiso'];
export const CIERRE = ['salida', 'fuera'];
export const MOTIVOS_OLVIDO = {
  olvido: 'Me olvidé de marcar la salida',
  corte: 'Se cortó la luz o internet',
  urgencia: 'Tuve que salir por una urgencia',
  sistema: 'Problema con el sistema o la computadora',
  otro: 'Otro motivo'
};
const DIA_MS = 86400000;
const siguienteDia = ymd => fechaLocal(new Date(inicioDia(ymd).getTime() + DIA_MS + 3 * 3600e3));
const finDelDia = ts => inicioDia(siguienteDia(fechaLocal(ts))).getTime();

/**
 * Calcula los tiempos de cada asesor en [ini, fin). Pura, para poder probarla.
 * marcas: [{ usuario_id, estado, ts, motivo, origen }] ordenadas por usuario y fecha
 * (pueden incluir marcaciones posteriores a fin, que solo sirven para saber si se marcó la salida).
 */
export function calcularTiempos(marcas, { ini, fin, ahora = new Date(), finTurno = null }) {
  const a = new Date(ini).getTime(), b = Math.min(new Date(fin).getTime(), new Date(ahora).getTime());
  const hoy = fechaLocal(ahora);
  const porUsuario = new Map();
  for (const m of marcas) {
    if (!porUsuario.has(m.usuario_id)) porUsuario.set(m.usuario_id, []);
    porUsuario.get(m.usuario_id).push({ ...m, t: new Date(m.ts).getTime() });
  }
  const out = {};
  for (const [uid, lista] of porUsuario) {
    lista.sort((x, y) => x.t - y.t);
    const r = { segundos: Object.fromEntries(TRABAJO.map(e => [e, 0])), conectado: 0, dias: 0, sinSalida: 0, sinJustificar: 0, motivos: [] };
    const dias = new Set();
    // Detalle de cada día: tramos con hora de inicio y fin, entrada, salida y motivo si la salida se cargó después.
    r.porDia = {};
    const delDia = dia => (r.porDia[dia] ||= { segundos: Object.fromEntries(TRABAJO.map(e => [e, 0])), conectado: 0, tramos: [], entrada: null, salida: null, sinSalida: false, enCurso: false });
    lista.forEach((m, i) => {
      const sig = lista[i + 1];
      if (TRABAJO.includes(m.estado)) {
        const desde = Math.max(m.t, a);
        let hasta = Math.min(sig ? sig.t : Infinity, finDelDia(m.t), b), estimado = false;
        // Día anterior sin salida marcada: el último estado se corta en la salida de su turno (estimado), no a medianoche.
        if ((!sig || fechaLocal(sig.t) > fechaLocal(m.t)) && fechaLocal(m.t) < hoy && finTurno) {
          const ft = finTurno(uid, fechaLocal(m.t));
          if (ft && ft > m.t && ft < hasta) { hasta = Math.min(ft, b); estimado = true; }
        }
        if (hasta > desde) {
          const seg = Math.round((hasta - desde) / 1000), dia = fechaLocal(desde), d = delDia(dia);
          r.segundos[m.estado] += seg; dias.add(dia);
          d.segundos[m.estado] += seg; d.conectado += seg;
          d.tramos.push({ estado: m.estado, ini: new Date(desde).toISOString(), fin: new Date(hasta).toISOString(), segundos: seg, ...(estimado ? { estimado: true } : {}) });
          if (estimado) d.estimado = true;
          if (!d.entrada) d.entrada = new Date(desde).toISOString();
          d.salida = null; // si vuelve a trabajar, la salida es la última del día
          if (!sig && fechaLocal(m.t) === hoy && hasta >= b - 1000) d.enCurso = true;
        }
        // Último estado de trabajo del día sin salida marcada (ni al día siguiente con motivo).
        const dia = fechaLocal(m.t);
        if (m.t >= a && m.t < b && dia < hoy && (!sig || fechaLocal(sig.t) > dia)) { r.sinSalida++; r.sinJustificar++; delDia(dia).sinSalida = true; }
      }
      if (CIERRE.includes(m.estado) && m.t >= a && m.t < b) {
        const d = r.porDia[fechaLocal(m.t)];
        if (d) d.salida = { hora: new Date(m.t).toISOString(), estado: m.estado, cargadaDespues: m.origen === 'olvido', motivo: m.origen === 'olvido' ? (m.motivo || '') : null };
      }
      if (m.origen === 'olvido' && m.t >= a && m.t < b) {
        r.sinSalida++;
        r.motivos.push({ dia: fechaLocal(m.t), hora: new Date(m.t).toISOString(), motivo: m.motivo || '' });
      }
    });
    r.dias = dias.size;
    r.conectado = TRABAJO.reduce((s, e) => s + r.segundos[e], 0);
    out[uid] = r;
  }
  return out;
}

export async function tiemposAsesores(empresaId, ids, rango, ahora = new Date()) {
  if (!ids.length) return {};
  const { rows } = await q(
    `SELECT usuario_id, estado, ts, motivo, origen FROM marcaciones
      WHERE empresa_id=$1 AND usuario_id = ANY($2::uuid[]) AND ts >= $3::timestamptz AND ts < $4::timestamptz + interval '7 days'
      ORDER BY usuario_id, ts`, [empresaId, ids, rango.ini.toISOString(), rango.fin.toISOString()]);
  return calcularTiempos(rows, { ini: rango.ini, fin: rango.fin, ahora, finTurno: await turnos(empresaId, ids, rango) });
}
/** Hora de salida de cada asesor por día: extensión confirmada ese día, su horario o el de la empresa. */
async function turnos(empresaId, ids, rango) {
  const [emp, ag, resp] = await Promise.all([
    q("SELECT dia,to_char(salida,'HH24:MI') AS salida FROM horarios_empresa WHERE empresa_id=$1 AND activo", [empresaId]),
    q("SELECT usuario_id,dia,to_char(salida,'HH24:MI') AS salida FROM horarios_agentes WHERE empresa_id=$1 AND activo AND usuario_id = ANY($2::uuid[])", [empresaId, ids]),
    q(`SELECT usuario_id,to_char(dia_fecha,'YYYY-MM-DD') AS dia,to_char(CASE WHEN decision='extra' THEN hasta ELSE confirmado_para END,'HH24:MI') AS salida
         FROM horarios_respuestas WHERE empresa_id=$1 AND usuario_id = ANY($2::uuid[]) AND dia_fecha >= $3::date AND dia_fecha < $4::date`,
      [empresaId, ids, fechaLocal(rango.ini), fechaLocal(rango.fin)])
  ]).catch(() => [{ rows: [] }, { rows: [] }, { rows: [] }]);
  const porDia = new Map(emp.rows.map(r => [Number(r.dia), r.salida]));
  const porAgente = new Map(ag.rows.map(r => [`${r.usuario_id}|${r.dia}`, r.salida]));
  const porFecha = new Map(resp.rows.map(r => [`${r.usuario_id}|${r.dia}`, r.salida]));
  return (uid, dia) => {
    const dow = new Date(dia + 'T12:00:00Z').getUTCDay();
    const h = porFecha.get(`${uid}|${dia}`) || porAgente.get(`${uid}|${dow}`) || porDia.get(dow);
    if (!h) return null;
    const [hh, mm] = h.split(':').map(Number);
    return inicioDia(dia).getTime() + (hh * 60 + mm) * 60000;
  };
}

/** ¿Quedó abierta la jornada de un día anterior? Devuelve { estado, desde, dia } o null. */
export async function salidaPendiente(usuarioId, ahora = new Date()) {
  const { rows } = await q("SELECT estado, ts FROM marcaciones WHERE usuario_id=$1 AND ts > now() - interval '30 days' ORDER BY ts DESC LIMIT 1", [usuarioId]);
  const m = rows[0];
  if (!m || !TRABAJO.includes(m.estado)) return null;
  const dia = fechaLocal(m.ts);
  if (dia >= fechaLocal(ahora)) return null;
  return { estado: m.estado, desde: new Date(m.ts).toISOString(), dia, sugerida: await horaSugerida(usuarioId, dia, m.ts).catch(() => null) };
}
/** Hora de salida que propone el formulario: la extensión confirmada ese día o el horario de su turno. */
async function horaSugerida(usuarioId, dia, desde) {
  const dow = new Date(dia + 'T12:00:00Z').getUTCDay();
  const { rows } = await q(`SELECT COALESCE(
      (SELECT to_char(CASE WHEN r.decision='extra' THEN r.hasta ELSE r.confirmado_para END,'HH24:MI') FROM horarios_respuestas r WHERE r.usuario_id=$1 AND r.dia_fecha=$2::date),
      (SELECT to_char(h.salida,'HH24:MI') FROM horarios_agentes h WHERE h.usuario_id=$1 AND h.dia=$3 AND h.activo),
      (SELECT to_char(e.salida,'HH24:MI') FROM horarios_empresa e JOIN usuarios u ON u.empresa_id=e.empresa_id WHERE u.id=$1 AND e.dia=$3 AND e.activo)) AS hora`,
    [usuarioId, dia, dow]);
  const h = rows[0]?.hora;
  if (!h) return null;
  const [hh, mm] = h.split(':').map(Number);
  return inicioDia(dia).getTime() + (hh * 60 + mm) * 60000 > new Date(desde).getTime() ? h : null;
}

/** Guarda la salida olvidada: hora aproximada de ese día y motivo. */
export async function registrarOlvido(empresaId, usuarioId, { hora, motivo, detalle } = {}, ahora = new Date()) {
  const err = (s, m) => Object.assign(new Error(m), { status: s });
  const p = await salidaPendiente(usuarioId, ahora);
  if (!p) throw err(409, 'No hay ninguna salida pendiente de marcar.');
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(hora || ''));
  if (!m) throw err(422, 'Indicá la hora aproximada en la que terminaste.');
  if (!MOTIVOS_OLVIDO[motivo]) throw err(422, 'Elegí un motivo.');
  const extra = String(detalle || '').trim().slice(0, 300);
  if (motivo === 'otro' && extra.length < 4) throw err(422, 'Contanos brevemente el motivo.');
  const ts = new Date(inicioDia(p.dia).getTime() + (Number(m[1]) * 60 + Number(m[2])) * 60000);
  if (ts.getTime() <= new Date(p.desde).getTime()) throw err(422, `La hora tiene que ser posterior a tu última marcación (${new Date(p.desde).toLocaleTimeString('es-PY', { timeZone: 'America/Asuncion', hour: '2-digit', minute: '2-digit' })}).`);
  if (ts.getTime() >= inicioDia(siguienteDia(p.dia)).getTime()) throw err(422, 'La hora tiene que ser de ese mismo día.');
  const texto = MOTIVOS_OLVIDO[motivo] + (extra ? ': ' + extra : '');
  await q(`INSERT INTO marcaciones (empresa_id,usuario_id,estado,ts,motivo,origen) VALUES ($1,$2,'salida',$3,$4,'olvido')`, [empresaId, usuarioId, ts.toISOString(), texto]);
  return { ok: true, dia: p.dia, hora: ts.toISOString(), motivo: texto };
}
