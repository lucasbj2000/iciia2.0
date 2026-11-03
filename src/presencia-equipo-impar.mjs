/* IMPAR · Presencia del equipo: quién está mirando o escribiendo en cada negociación.
   Vive en memoria (es efímera por naturaleza) y caduca sola si una pestaña se cierra. */
import { emitir } from './realtime.mjs';

export const VIDA_MS = 45000;
const mapa = new Map(); // `${empresa}:${negociacion}` → { personas: Map(uid → persona), destinatarios: Set(uid) }

const clave = (eid, id) => `${eid}:${id}`;
const vivos = (e, ahora = Date.now()) => [...e.personas.values()].filter(p => p.hasta > ahora)
  .map(({ id, nombre, foto, redactando }) => ({ id, nombre, foto, redactando }));

function avisar(eid, negId, e) {
  const quienes = vivos(e);
  const uids = [...new Set([...e.destinatarios, ...e.personas.keys()])];
  if (uids.length) emitir(eid, 'equipo:viendo', { id: negId, quienes }, uids);
  if (!quienes.length) mapa.delete(clave(eid, negId));
}

/** Marca (o retira) a una persona en una negociación y avisa a quienes pueden verla. */
export function marcarPresencia(eid, negId, usuario, { redactando = false, salir = false } = {}, destinatarios = []) {
  const k = clave(eid, negId);
  const e = mapa.get(k) || { personas: new Map(), destinatarios: new Set() };
  for (const uid of destinatarios) e.destinatarios.add(uid);
  const antes = e.personas.get(usuario.id);
  if (salir) e.personas.delete(usuario.id);
  else e.personas.set(usuario.id, { id: usuario.id, nombre: usuario.nombre, foto: usuario.foto || null,
    redactando: !!redactando, hasta: Date.now() + VIDA_MS });
  mapa.set(k, e);
  const cambio = salir ? !!antes : !antes || antes.redactando !== !!redactando || antes.hasta <= Date.now();
  if (cambio) avisar(eid, negId, e);
  return vivos(e);
}

/** Presencias actuales de una empresa (solo ids; el que llama filtra por permisos). */
export function presenciasEmpresa(eid) {
  const out = {}, pref = eid + ':';
  for (const [k, e] of mapa) if (k.startsWith(pref)) { const v = vivos(e); if (v.length) out[k.slice(pref.length)] = v; }
  return out;
}

/** Retira a quien dejó de latir (pestaña cerrada, celular bloqueado). */
export function barrerPresencias(ahora = Date.now()) {
  for (const [k, e] of mapa) {
    let cambio = false;
    for (const [uid, p] of e.personas) if (p.hasta <= ahora) { e.personas.delete(uid); cambio = true; }
    if (cambio) { const i = k.indexOf(':'); avisar(k.slice(0, i), k.slice(i + 1), e); }
    else if (!e.personas.size) mapa.delete(k);
  }
}
const barrido = setInterval(barrerPresencias, 15000);
barrido.unref?.();
