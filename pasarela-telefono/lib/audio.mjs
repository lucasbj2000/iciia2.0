/** Audio de la llamada: el sonido Bluetooth del celular (PipeWire) ↔ WebRTC con el navegador del agente. */
import { execFile, spawn } from 'node:child_process';

const TASA = 48000, MUESTRAS = TASA / 100; // WebRTC trabaja en bloques de 10 ms

function pactl(args) {
  return new Promise((ok, mal) => execFile('pactl', args, { timeout: 5000 }, (e, s, err) => e ? mal(new Error(String(err || e.message).trim())) : ok(String(s))));
}
/** Pone el celular en modo manos libres (HFP) y espera a que aparezcan su micrófono y su parlante. */
export async function dispositivosBluetooth({ espera = 10000 } = {}) {
  const tarjetas = (await pactl(['list', 'short', 'cards']).catch(() => '')).split('\n').map(l => l.split('\t')[1]).filter(n => /^bluez_card\./.test(n || ''));
  for (const t of tarjetas) {
    for (const perfil of ['headset-head-unit', 'headset-head-unit-msbc', 'headset-head-unit-cvsd']) {
      if (await pactl(['set-card-profile', t, perfil]).then(() => true, () => false)) break;
    }
  }
  const hasta = Date.now() + espera;
  while (Date.now() < hasta) {
    const fuentes = (await pactl(['list', 'short', 'sources']).catch(() => '')).split('\n').map(l => l.split('\t')[1]).filter(Boolean);
    const salidas = (await pactl(['list', 'short', 'sinks']).catch(() => '')).split('\n').map(l => l.split('\t')[1]).filter(Boolean);
    const entrada = fuentes.find(n => /^bluez_input\./.test(n) && !/\.monitor$/.test(n));
    const salida = salidas.find(n => /^bluez_output\./.test(n));
    if (entrada && salida) return { entrada, salida };
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error('No apareció el audio Bluetooth del celular. Revisá que el celular tenga habilitado «Llamadas telefónicas» para esta computadora.');
}

/** Corta un flujo PCM s16le mono 48 kHz en bloques de 10 ms. Pura, para poder probarla. */
export function cortadorPCM(entregar) {
  let resto = Buffer.alloc(0);
  return trozo => {
    resto = resto.length ? Buffer.concat([resto, trozo]) : trozo;
    const tam = MUESTRAS * 2;
    let i = 0;
    for (; i + tam <= resto.length; i += tam) {
      const m = new Int16Array(MUESTRAS);
      for (let j = 0; j < MUESTRAS; j++) m[j] = resto.readInt16LE(i + j * 2);
      entregar(m);
    }
    resto = resto.subarray(i);
  };
}
/** Bloque recibido del navegador → PCM s16le mono (mezcla canales si vienen en estéreo). */
export function aMono({ samples, channelCount = 1 }) {
  if (channelCount <= 1) return Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength);
  const n = Math.floor(samples.length / channelCount), out = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) { let s = 0; for (let c = 0; c < channelCount; c++) s += samples[i * channelCount + c]; out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(s / channelCount))), i * 2); }
  return out;
}

export class PuenteAudio {
  constructor({ wrtc, iceServers, dispositivos = dispositivosBluetooth, lanzar = spawn, log = () => {} }) {
    Object.assign(this, { wrtc, iceServers, dispositivos, lanzar, log });
    this.procesos = []; this.pc = null; this.cerrado = false;
  }
  /** Prepara el audio y devuelve la oferta SDP para el navegador (ICE completo, sin trickle). */
  async iniciar() {
    const { entrada, salida } = await this.dispositivos();
    const { RTCPeerConnection, nonstandard: { RTCAudioSource, RTCAudioSink } } = this.wrtc;
    this.pc = new RTCPeerConnection({ iceServers: this.iceServers });
    const fuente = new RTCAudioSource();
    this.pc.addTrack(fuente.createTrack());
    // Celular → navegador
    const rec = this.lanzar('parec', [`--device=${entrada}`, '--format=s16le', `--rate=${TASA}`, '--channels=1', '--raw', '--latency-msec=20']);
    this.procesos.push(rec);
    const cortar = cortadorPCM(samples => { if (!this.cerrado) fuente.onData({ samples, sampleRate: TASA, bitsPerSample: 16, channelCount: 1, numberOfFrames: MUESTRAS }); });
    rec.stdout.on('data', cortar);
    rec.on('error', e => this.log('parec: ' + e.message));
    // Navegador → celular (se lanza al llegar el primer bloque, con su tasa real)
    this.pc.ontrack = ev => {
      const sink = new RTCAudioSink(ev.track); this.sink = sink;
      let play = null;
      sink.ondata = d => {
        if (this.cerrado) return;
        if (!play) {
          play = this.lanzar('pacat', ['--playback', `--device=${salida}`, '--format=s16le', `--rate=${d.sampleRate || TASA}`, '--channels=1', '--raw', '--latency-msec=40']);
          play.on('error', e => this.log('pacat: ' + e.message)); play.stdin.on('error', () => {});
          this.procesos.push(play);
        }
        play.stdin.write(aMono(d));
      };
    };
    const oferta = await this.pc.createOffer();
    await this.pc.setLocalDescription(oferta);
    await new Promise(ok => {
      if (this.pc.iceGatheringState === 'complete') return ok();
      const t = setTimeout(ok, 3000);
      this.pc.onicegatheringstatechange = () => { if (this.pc.iceGatheringState === 'complete') { clearTimeout(t); ok(); } };
    });
    return this.pc.localDescription.sdp;
  }
  async respuesta(sdp) { await this.pc.setRemoteDescription({ type: 'answer', sdp }); }
  cerrar() {
    this.cerrado = true;
    try { this.sink?.stop(); } catch { /* nada */ }
    for (const p of this.procesos) { try { p.kill('SIGTERM'); } catch { /* nada */ } }
    try { this.pc?.close(); } catch { /* nada */ }
  }
}

/** Modo «tono» (PASARELA_AUDIO=tono): sin celular ni Bluetooth. Manda un tono de 440 Hz al navegador y
 * cuenta el audio que llega del navegador. Sirve para probar la red y el CRM antes de instalar el celular. */
export const dispositivosTono = async () => ({ entrada: 'tono', salida: 'nulo' });
export function lanzarTono(cmd) {
  const gen = `let t=0;const b=Buffer.alloc(960);setInterval(()=>{for(let i=0;i<480;i++,t++)b.writeInt16LE(Math.round(Math.sin(2*Math.PI*440*t/48000)*8000),i*2);process.stdout.write(b)},10)`;
  const cuenta = `let n=0;process.stdin.on('data',d=>{n+=d.length});setInterval(()=>console.error('[tono] audio recibido del navegador: '+n+' bytes'),2000)`;
  return spawn(process.execPath, ['-e', cmd === 'parec' ? gen : cuenta], { stdio: ['pipe', 'pipe', 'inherit'] });
}
