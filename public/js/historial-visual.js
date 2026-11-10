/* IMPAR · Historial de la negociación como línea de tiempo que se lee de un vistazo.
   Junta los cambios registrados (auditoría) y la actividad del sistema, los agrupa por día y por
   «momento» (misma persona, pocos minutos) y cuenta cada uno en una frase: quién hizo qué, con
   nombres de personas, etapas con su color y sin identificadores internos. */
import { esc, etapa, gs, iniciales, S } from './core.js';
import { ic } from './iconos.js';

const VENTANA_MS = 2 * 60 * 1000;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CAMPOS_CLIENTE = { nombre: 'el nombre', tel: 'el teléfono', email: 'el correo', doc: 'el documento', ciudad: 'la ciudad', direccion: 'la dirección', notas: 'las notas' };
const ORIGEN = { whatsapp: 'WhatsApp', messenger: 'Messenger', instagram: 'Instagram', web: 'la web', manual: 'carga manual' };

const chip = id => { const e = etapa(id); return `<span class="hv-etapa" style="--c:${esc(e.color || '#888')}">${esc(e.nombre || id || '—')}</span>`; };
const fuerte = t => `<b>${esc(t)}</b>`;
const texto = v => v == null || v === '' ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v);

/** Una línea de auditoría → { prio, tipo, icono, frase, antes } (frase y antes ya en HTML). */
function describir(c, persona, automatico = false) {
  const nombre = v => (typeof v === 'string' && uuid.test(v)) ? (persona(v) || 'otra persona') : texto(v);
  const de = c.anterior;
  if (c.operacion === 'INSERT' && c.campo === 'registro') {
    if (c.entidad === 'negociaciones') {
      const o = c.nuevo?.origen; return { prio: 6, tipo: 'alta', icono: 'mas', frase: `Se creó la negociación${o ? ` · ingresó por ${esc(ORIGEN[o] || o)}` : ''}` };
    }
    return { prio: 2, tipo: 'alta', icono: 'usuario', frase: 'Se registró el cliente' };
  }
  if (c.operacion === 'DELETE') return { prio: 9, tipo: 'baja', icono: 'alerta', frase: c.entidad === 'contactos' ? 'Se eliminó el cliente' : 'Se eliminó la negociación' };
  switch (c.campo) {
    case 'etapa': return { prio: 8, tipo: 'etapa', icono: 'flecha-der', frase: `Pasó a ${chip(c.nuevo)}`, antes: de ? `Estaba en ${chip(de)}` : '' };
    case 'agente_id': return { prio: 10, tipo: 'transfer', icono: 'transferir', frase: c.nuevo ? `${automatico ? 'Se asignó a' : 'Transfirió la negociación a'} ${fuerte(nombre(c.nuevo))}` : 'Quedó sin responsable', antes: de ? `Antes la tenía ${fuerte(nombre(de))}` : '' };
    case 'responsable_id': return { prio: 3, tipo: 'transfer', icono: 'usuario', frase: c.nuevo ? `El cliente pasa a ser de ${fuerte(nombre(c.nuevo))}` : 'El cliente quedó sin responsable', antes: de ? `Antes era de ${fuerte(nombre(de))}` : '' };
    case 'sucursal': return { prio: 7, tipo: 'lugar', icono: 'pin', frase: `Pasó a la sucursal ${fuerte(texto(c.nuevo))}`, antes: de ? `Antes: ${esc(texto(de))}` : '' };
    case 'linea': return { prio: 5, tipo: 'lugar', icono: 'canal', frase: `Pasó a la línea ${fuerte(texto(c.nuevo))}`, antes: de ? `Antes: ${esc(texto(de))}` : '' };
    case 'motivo': return { prio: 7, tipo: 'cierre', icono: 'portapapeles', frase: c.nuevo ? `Motivo de cierre: ${fuerte(texto(c.nuevo))}` : 'Se quitó el motivo de cierre' };
    case 'bot_activo': return { prio: 4, tipo: 'bot', icono: 'bot', frase: c.nuevo ? 'Encendió el bot' : 'Apagó el bot' };
    case 'valor': case 'monto_cierre':
      return { prio: 6, tipo: 'monto', icono: 'dinero', frase: `${c.campo === 'valor' ? 'Valor estimado' : 'Monto de cierre'}: ${fuerte(gs(c.nuevo))}`, antes: de != null ? `Antes: ${esc(gs(de))}` : '' };
    case 'titulo': return { prio: 3, tipo: 'dato', icono: 'lapiz', frase: `Cambió el título a ${fuerte(texto(c.nuevo))}` };
    case 'nota_interna': return { prio: 4, tipo: 'nota', icono: 'documento', frase: 'Agregó una nota interna' };
    default:
      if (CAMPOS_CLIENTE[c.campo]) return { prio: 2, tipo: 'dato', icono: 'lapiz', frase: `Actualizó ${CAMPOS_CLIENTE[c.campo]} del cliente: ${fuerte(texto(c.nuevo))}`, antes: de ? `Antes: ${esc(texto(de))}` : '' };
      return { prio: 1, tipo: 'dato', icono: 'lapiz', frase: `Cambió «${esc(c.campo)}»: ${fuerte(texto(c.nuevo))}`, antes: de != null ? `Antes: ${esc(texto(de))}` : '' };
  }
}

/** Una línea de actividad del sistema → mismo formato. */
function describirActividad(h) {
  const t = String(h.txt || '');
  const tipo = /transferid/i.test(t) ? 'transfer' : /respondió|escribió/i.test(t) ? 'cliente' : /cierre|cerr/i.test(t) ? 'cierre'
    : /ingreso|nueva negociaci|re contact/i.test(t) ? 'alta' : /enviado/i.test(t) ? 'envio' : /→/.test(t) ? 'etapa' : 'info';
  const icono = { transfer: 'transferir', cliente: 'mensaje', cierre: 'reloj', alta: 'mas', envio: 'responder', etapa: 'flecha-der', info: 'info' }[tipo];
  return { prio: tipo === 'cliente' ? 6 : tipo === 'transfer' ? 9 : 2, tipo, icono, frase: esc(t.replace(/^[⇄🔗]\s*/u, '')), actividad: true };
}

const dia = d => {
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const x = new Date(d); x.setHours(0, 0, 0, 0);
  const dif = Math.round((hoy - x) / 86400000);
  if (dif === 0) return 'Hoy';
  if (dif === 1) return 'Ayer';
  const t = x.toLocaleDateString('es-PY', { weekday: 'long', day: 'numeric', month: 'long', year: x.getFullYear() === hoy.getFullYear() ? undefined : 'numeric' });
  return t.charAt(0).toUpperCase() + t.slice(1);
};
const hora = d => new Date(d).toLocaleTimeString('es-PY', { hour: '2-digit', minute: '2-digit', hour12: false });
const esAutomatico = a => /^(sistema|bot|)$/i.test(String(a || '').trim());

/** HTML de la línea de tiempo. datos = { cambios, personas, autores, actividad }. */
export function historialVisual({ cambios = [], personas = {}, autores = {}, actividad = [] } = {}) {
  const persona = id => personas[id];
  const items = [
    ...cambios.map(c => { const autor = persona(c.usuario_id) || autores[c.usuario] || c.usuario || 'Sistema';
      return { ts: new Date(c.ts).getTime(), autor, ...describir(c, persona, esAutomatico(autor)), raw: c }; }),
    ...actividad.map(h => ({ ts: new Date(h.ts).getTime(), autor: h.por || 'Sistema', ...describirActividad(h) }))
  ].sort((a, b) => b.ts - a.ts);
  if (!items.length) return '<p class="hv-vacio">Todavía no hay movimientos en esta negociación.</p>';

  // Momentos: misma persona (o el sistema) dentro de pocos minutos.
  const momentos = [];
  for (const it of items) {
    const ult = momentos.at(-1);
    const mismo = ult && ult.items[0].ts - it.ts <= VENTANA_MS && (ult.autor === it.autor || (esAutomatico(ult.autor) && esAutomatico(it.autor)));
    if (mismo) ult.items.push(it); else momentos.push({ autor: it.autor, ts: it.ts, items: [it] });
  }
  for (const m of momentos) {
    m.items.sort((a, b) => b.prio - a.prio || Number(!!a.actividad) - Number(!!b.actividad));
    const tipos = new Set(m.items.filter(i => !i.actividad).map(i => i.tipo));
    // Lo que la actividad repite de un cambio ya contado (transferencias, etapas) no se muestra dos veces.
    m.items = m.items.filter(i => !(i.actividad && ((i.tipo === 'transfer' && tipos.has('transfer')) || (i.tipo === 'etapa' && tipos.has('etapa')))));
    m.principal = m.items[0];
  }

  const admin = S.usuario?.rol === 'admin';
  let html = '', diaActual = '';
  for (const m of momentos) {
    const d = dia(m.ts);
    if (d !== diaActual) { html += `${diaActual ? '</ol>' : ''}<h4 class="hv-dia">${esc(d)}</h4><ol class="hv-lista">`; diaActual = d; }
    const p = m.principal, resto = m.items.slice(1), auto = esAutomatico(m.autor);
    const quien = auto ? (/bot/i.test(m.autor) ? 'Bot' : 'Sistema') : m.autor;
    html += `<li class="hv-momento t-${p.tipo}">
      <span class="hv-punto" aria-hidden="true">${ic(p.icono)}</span>
      <article class="hv-tarjeta">
        <header><span class="hv-av${auto ? ' auto' : ''}" aria-hidden="true">${auto ? ic(/bot/i.test(m.autor) ? 'bot' : 'info') : esc(iniciales(quien))}</span>
          <span class="hv-quien"><b>${esc(quien)}</b><time datetime="${new Date(m.ts).toISOString()}">${hora(m.ts)}</time></span></header>
        <p class="hv-frase">${p.frase}</p>${p.antes ? `<p class="hv-antes">${p.antes}</p>` : ''}
        ${resto.length ? `<ul class="hv-detalles">${resto.map(i => `<li><span class="hv-mini" aria-hidden="true">${ic(i.icono)}</span><span>${i.frase}${i.antes ? ` <small>· ${i.antes}</small>` : ''}</span></li>`).join('')}</ul>` : ''}
        ${admin && m.items.some(i => i.raw) ? `<details class="hv-tecnico"><summary>Datos técnicos</summary><pre>${esc(m.items.filter(i => i.raw).map(i => `${i.raw.entidad}.${i.raw.campo}: ${texto(i.raw.anterior)} → ${texto(i.raw.nuevo)} (${i.raw.usuario})`).join('\n'))}</pre></details>` : ''}
      </article></li>`;
  }
  return html + '</ol>';
}
