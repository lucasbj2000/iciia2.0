/** Telefonía Bluetooth de PipeWire (≥ 1.4) por D-Bus, usando busctl (viene con systemd).
 * El celular es el «audio gateway» y esta computadora hace de manos libres. */
import { execFile } from 'node:child_process';
import { EventEmitter } from 'node:events';

const SERVICIO = 'org.pipewire.Telephony';
const RAIZ = '/org/pipewire/Telephony';
const IF_AG = 'org.pipewire.Telephony.AudioGateway1';
const IF_LLAMADA = 'org.pipewire.Telephony.Call1';

export function busctl(args, { ejecutar = execFile } = {}) {
  return new Promise((ok, mal) => ejecutar('busctl', ['--user', '--json=short', ...args], { timeout: 8000 }, (e, salida, error) => {
    if (e) return mal(new Error(String(error || e.message).trim().split('\n')[0]));
    try { ok(String(salida).trim() ? JSON.parse(salida) : null); } catch { ok(null); }
  }));
}
const valor = v => (v && typeof v === 'object' && 'type' in v && 'data' in v) ? v.data : v;
/** Convierte la respuesta de GetManagedObjects en { ruta: { interfaz: { propiedad: valor } } }. */
export function objetos(respuesta) {
  const d = respuesta?.data?.[0] || {};
  const out = {};
  for (const [ruta, ifs] of Object.entries(d)) {
    out[ruta] = {};
    for (const [i, props] of Object.entries(ifs || {})) {
      out[ruta][i] = {};
      for (const [k, v] of Object.entries(props || {})) out[ruta][i][k] = valor(v);
    }
  }
  return out;
}

export class Telefonia extends EventEmitter {
  constructor({ cada = 1000, bus = busctl } = {}) {
    super();
    this.cada = cada; this.bus = bus;
    this.ag = null; this.llamadas = new Map(); this.timer = null; this.avisoSinServicio = false;
  }
  iniciar() { const vuelta = async () => { await this.revisar().catch(() => {}); this.timer = setTimeout(vuelta, this.cada); }; vuelta(); }
  detener() { clearTimeout(this.timer); }

  async revisar() {
    let todos = {};
    try { todos = objetos(await this.bus(['call', SERVICIO, RAIZ, 'org.freedesktop.DBus.ObjectManager', 'GetManagedObjects'])); this.avisoSinServicio = false; }
    catch (e) {
      if (!this.avisoSinServicio) { this.avisoSinServicio = true; this.emit('aviso', 'El servicio de telefonía de PipeWire no responde (¿PipeWire 1.4 o superior y el celular emparejado?): ' + e.message); }
      this.cambiarAG(null); this.sincronizar({}); return;
    }
    const ag = Object.keys(todos).find(r => todos[r][IF_AG]) || null;
    this.cambiarAG(ag);
    if (ag) { // las llamadas también se anuncian en el ObjectManager del propio celular
      try { Object.assign(todos, objetos(await this.bus(['call', SERVICIO, ag, 'org.freedesktop.DBus.ObjectManager', 'GetManagedObjects']))); } catch { /* alcanza con la raíz */ }
    }
    const actuales = {};
    for (const [ruta, ifs] of Object.entries(todos)) if (ifs[IF_LLAMADA]) actuales[ruta] = ifs[IF_LLAMADA];
    this.sincronizar(actuales);
  }
  cambiarAG(ag) { if (ag !== this.ag) { this.ag = ag; this.emit('equipo', { celular: !!ag }); } }
  /** Compara con la vuelta anterior y avisa llamadas nuevas, cambios de estado y llamadas terminadas. */
  sincronizar(actuales) {
    for (const [ruta, p] of Object.entries(actuales)) {
      const estado = String(p.State || ''), previa = this.llamadas.get(ruta);
      if (!previa) { this.llamadas.set(ruta, estado); this.emit('llamada', { ref: ruta, estado, numero: String(p.LineIdentification || ''), nombre: String(p.Name || '') }); }
      else if (previa !== estado) { this.llamadas.set(ruta, estado); this.emit('estado', { ref: ruta, estado }); }
      if (estado === 'disconnected' && this.llamadas.has(ruta)) { this.llamadas.delete(ruta); this.emit('fin', { ref: ruta }); }
    }
    for (const ruta of [...this.llamadas.keys()]) if (!actuales[ruta]) { this.llamadas.delete(ruta); this.emit('fin', { ref: ruta }); }
  }

  async marcar(numero) {
    if (!this.ag) throw new Error('No hay un celular conectado por Bluetooth.');
    if (!/^[0-9+*#,ABCD]{1,80}$/.test(numero)) throw new Error('Número inválido para marcar.');
    await this.bus(['call', SERVICIO, this.ag, IF_AG, 'Dial', 's', numero]);
  }
  atender(ref) { return this.bus(['call', SERVICIO, ref, IF_LLAMADA, 'Answer']); }
  cortar(ref) { return this.bus(['call', SERVICIO, ref, IF_LLAMADA, 'Hangup']); }
  cortarTodas() { return this.ag ? this.bus(['call', SERVICIO, this.ag, IF_AG, 'HangupAll']) : Promise.resolve(); }
}
