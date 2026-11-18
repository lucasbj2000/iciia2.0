/** Audio de la central telefónica: RTP con G.711 (PCMU/PCMA) ↔ WebRTC con el navegador del agente. */
import dgram from 'node:dgram';

/* ---------- G.711 ---------- */
export function linealAUlaw(s) {
  const BIAS = 0x84, CLIP = 32635;
  let signo = (s >> 8) & 0x80; if (signo) s = -s; if (s > CLIP) s = CLIP; s += BIAS;
  let exp = 7; for (let m = 0x4000; (s & m) === 0 && exp > 0; m >>= 1) exp--;
  const man = (s >> (exp + 3)) & 0x0F;
  return ~(signo | (exp << 4) | man) & 0xFF;
}
export function ulawALineal(u) {
  u = ~u & 0xFF; const signo = u & 0x80, exp = (u >> 4) & 7, man = u & 0x0F;
  const s = (((man << 3) + 0x84) << exp) - 0x84;
  return signo ? -s : s;
}
export function linealAAlaw(s) {
  let signo = 0x80; if (s < 0) { signo = 0; s = -s - 1; } if (s > 32767) s = 32767;
  let exp = 7; for (let m = 0x4000; (s & m) === 0 && exp > 0; m >>= 1) exp--;
  const man = exp === 0 ? (s >> 4) & 0x0F : (s >> (exp + 3)) & 0x0F;
  return ((signo | (exp << 4) | man) ^ 0x55) & 0xFF;
}
export function alawALineal(a) {
  a ^= 0x55; const signo = a & 0x80, exp = (a >> 4) & 7, man = a & 0x0F;
  let s = exp === 0 ? (man << 4) + 8 : ((man << 4) + 0x108) << (exp - 1);
  return signo ? s : -s;
}
const T_ULAW = Int16Array.from({ length: 256 }, (_, i) => ulawALineal(i));
const T_ALAW = Int16Array.from({ length: 256 }, (_, i) => alawALineal(i));
export const CODECS = { 0: { nombre: 'PCMU', dec: b => T_ULAW[b], cod: linealAUlaw }, 8: { nombre: 'PCMA', dec: b => T_ALAW[b], cod: linealAAlaw } };

/* ---------- Remuestreo (8 kHz ↔ tasa de WebRTC) ---------- */
/** 8 kHz → `tasa` por interpolación lineal; `prev` es la última muestra del bloque anterior. */
export function subir(m8, tasa, prev = 0) {
  const f = tasa / 8000, n = Math.round(m8.length * f), out = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const x = i / f - (1 - 1 / f), j = Math.floor(x), t = x - j;
    const a = j < 0 ? prev : m8[j], b = m8[Math.min(m8.length - 1, j + 1)];
    out[i] = Math.round(a + (b - a) * t);
  }
  return out;
}
/** `tasa` → 8 kHz promediando cada grupo (filtro simple contra el aliasing). */
export function bajar(m, tasa) {
  const f = tasa / 8000, n = Math.floor(m.length / f), out = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.floor(i * f), b = Math.max(a + 1, Math.floor((i + 1) * f)); let s = 0;
    for (let j = a; j < b; j++) s += m[j];
    out[i] = Math.round(s / (b - a));
  }
  return out;
}

/* ---------- Sesión RTP ---------- */
const MUESTRAS = 160; // 20 ms a 8 kHz

/** Reloj de paso fijo que no acumula atraso (setInterval se corre con el tiempo). */
function reloj(ms, fn) {
  let siguiente = performance.now() + ms, t = null, vivo = true;
  const tic = () => {
    if (!vivo) return;
    let vueltas = 0;
    while (performance.now() >= siguiente && vueltas++ < 5) { fn(); siguiente += ms; }
    if (performance.now() - siguiente > ms * 10) siguiente = performance.now() + ms; // se durmió el proceso
    t = setTimeout(tic, Math.max(1, siguiente - performance.now()));
  };
  t = setTimeout(tic, ms);
  return () => { vivo = false; clearTimeout(t); };
}

export class SesionRTP {
  constructor({ ip, desde = 40000, hasta = 40100, log = () => {} }) {
    Object.assign(this, { ip, desde, hasta, log });
    this.pt = 0; this.remoto = null; this.enganchado = false; this.alAudio = null;
    this.sec = Math.floor(Math.random() * 65535); this.ts = Math.floor(Math.random() * 2 ** 31);
    this.ssrc = Math.floor(Math.random() * 2 ** 32) >>> 0;
    this.cola = []; this.recibidos = 0; this.enviados = 0; this.cerrada = false;
  }
  /** Abre el puerto (par) dentro del rango configurado. */
  async abrir() {
    const pares = []; for (let p = this.desde + (this.desde % 2); p <= this.hasta; p += 2) pares.push(p);
    for (let i = pares.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pares[i], pares[j]] = [pares[j], pares[i]]; }
    for (const p of pares) {
      const s = dgram.createSocket('udp4');
      const ok = await new Promise(r => { s.once('error', () => r(false)); s.bind(p, () => r(true)); });
      if (ok) { this.sock = s; this.puerto = p; break; }
      try { s.close(); } catch { /* nada */ }
    }
    if (!this.sock) throw new Error(`No hay puertos de audio libres entre ${this.desde} y ${this.hasta}.`);
    this.sock.on('message', (b, r) => this.recibir(b, r));
    this.sock.on('error', e => this.log('RTP: ' + e.message));
    this.parar = reloj(20, () => this.tic());
    return this.puerto;
  }
  /** Destino según el SDP de la central; se corrige con el primer paquete recibido (NAT). */
  destino(ip, puerto, pt) { if (!this.enganchado) this.remoto = { ip, puerto }; if (pt != null && CODECS[pt]) this.pt = pt; }
  recibir(b, r) {
    if (b.length < 12 || (b[0] >> 6) !== 2) return;
    const pt = b[1] & 0x7F; const c = CODECS[pt]; if (!c) return;
    if (!this.enganchado) { this.remoto = { ip: r.address, puerto: r.port }; this.enganchado = true; }
    const cc = b[0] & 0x0F, ext = b[0] & 0x10;
    let ini = 12 + cc * 4; if (ext && b.length >= ini + 4) ini += 4 + b.readUInt16BE(ini + 2) * 4;
    let fin = b.length; if (b[0] & 0x20) fin -= b[b.length - 1];
    const m = new Int16Array(Math.max(0, fin - ini)); for (let i = 0; i < m.length; i++) m[i] = c.dec(b[ini + i]);
    this.recibidos++; this.alAudio?.(m);
  }
  /** Audio del agente en 8 kHz; se manda en paquetes de 20 ms. */
  enviar(m8) { for (const v of m8) this.cola.push(v); if (this.cola.length > 8000) this.cola.splice(0, this.cola.length - 1600); }
  tic() {
    if (!this.remoto || this.cerrada) return;
    const c = CODECS[this.pt], b = Buffer.alloc(12 + MUESTRAS);
    b[0] = 0x80; b[1] = this.pt; b.writeUInt16BE(this.sec, 2); b.writeUInt32BE(this.ts >>> 0, 4); b.writeUInt32BE(this.ssrc, 8);
    const m = this.cola.length >= MUESTRAS ? this.cola.splice(0, MUESTRAS) : null;
    for (let i = 0; i < MUESTRAS; i++) b[12 + i] = c.cod(m ? m[i] : 0);
    this.sec = (this.sec + 1) & 0xFFFF; this.ts = (this.ts + MUESTRAS) >>> 0;
    this.sock.send(b, this.remoto.puerto, this.remoto.ip, () => {}); this.enviados++;
  }
  cerrar() { this.cerrada = true; this.parar?.(); try { this.sock?.close(); } catch { /* nada */ } }
}

/* ---------- Puente RTP ↔ WebRTC ---------- */
export class PuenteSIP {
  constructor({ wrtc, iceServers, rtp, log = () => {} }) { Object.assign(this, { wrtc, iceServers, rtp, log }); this.cerrado = false; }
  async iniciar() {
    const { RTCPeerConnection, nonstandard: { RTCAudioSource, RTCAudioSink } } = this.wrtc;
    const TASA = 48000, BLOQUE = 480;
    this.pc = new RTCPeerConnection({ iceServers: this.iceServers });
    const fuente = new RTCAudioSource();
    this.pc.addTrack(fuente.createTrack());
    // Central → navegador: colchón chico contra el jitter y bloques de 10 ms.
    let cola = [], prev = 0, listo = false;
    this.rtp.alAudio = m8 => {
      const m = subir(m8, TASA, prev); prev = m8[m8.length - 1] || 0;
      for (const v of m) cola.push(v);
      if (cola.length > TASA / 2) cola = cola.slice(-TASA / 10);   // si se acumula, se recorta (máx. 100 ms)
      if (!listo && cola.length >= BLOQUE * 6) listo = true;      // espera 60 ms antes de empezar
    };
    this.parar = reloj(10, () => {
      if (this.cerrado) return;
      const samples = new Int16Array(BLOQUE);
      if (listo && cola.length >= BLOQUE) samples.set(cola.splice(0, BLOQUE)); else if (listo && cola.length < BLOQUE) listo = false;
      fuente.onData({ samples, sampleRate: TASA, bitsPerSample: 16, channelCount: 1, numberOfFrames: BLOQUE });
    });
    // Navegador → central
    this.pc.ontrack = ev => {
      this.sink = new RTCAudioSink(ev.track);
      this.sink.ondata = d => {
        if (this.cerrado) return;
        const ch = d.channelCount || 1, n = Math.floor(d.samples.length / ch);
        let mono = d.samples; if (ch > 1) { mono = new Int16Array(n); for (let i = 0; i < n; i++) { let s = 0; for (let c = 0; c < ch; c++) s += d.samples[i * ch + c]; mono[i] = s / ch; } }
        this.rtp.enviar(bajar(mono, d.sampleRate || TASA));
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
    this.cerrado = true; this.parar?.(); this.rtp.alAudio = null;
    try { this.sink?.stop(); } catch { /* nada */ }
    try { this.pc?.close(); } catch { /* nada */ }
  }
}
