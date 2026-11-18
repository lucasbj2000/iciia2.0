/**
 * Telefonía por central IP (SIP sobre UDP), por ejemplo un Grandstream.
 * La pasarela se registra como un interno y ofrece la misma interfaz que la telefonía por
 * Bluetooth (lib/telefonia.mjs): eventos «equipo», «llamada», «estado», «fin», «aviso» y
 * los métodos marcar, atender, cortar y cortarTodas.
 * Nunca escribe números de teléfono ni contraseñas en los registros.
 */
import dgram from 'node:dgram';
import os from 'node:os';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { SesionRTP, CODECS } from './rtp.mjs';

const T1 = 500, T2 = 4000;
const azar = (n = 10) => crypto.randomBytes(n).toString('hex');
const md5 = s => crypto.createHash('md5').update(s).digest('hex');
const COMPACTAS = { v: 'via', f: 'from', t: 'to', i: 'call-id', m: 'contact', l: 'content-length', c: 'content-type', k: 'supported' };

/* ---------- Mensajes ---------- */
export function analizar(texto) {
  const corte = texto.indexOf('\r\n\r\n');
  const cab = (corte < 0 ? texto : texto.slice(0, corte)).split('\r\n');
  const cuerpo = corte < 0 ? '' : texto.slice(corte + 4);
  const primera = cab.shift() || '';
  const h = {};
  for (const l of cab) {
    const i = l.indexOf(':'); if (i < 0) continue;
    let k = l.slice(0, i).trim().toLowerCase(); k = COMPACTAS[k] || k;
    const v = l.slice(i + 1).trim();
    (h[k] ||= []).push(...(k === 'via' || k === 'record-route' || k === 'route' ? v.split(/,(?=\s*(?:SIP\/|<))/).map(x => x.trim()) : [v]));
  }
  const m = /^SIP\/2\.0 (\d{3}) ?(.*)$/.exec(primera);
  if (m) return { respuesta: true, codigo: +m[1], razon: m[2], h, cuerpo };
  const [metodo, uri] = primera.split(' ');
  return { respuesta: false, metodo, uri, h, cuerpo };
}
const uno = (msg, k) => msg.h[k]?.[0] || '';
const param = (v, p) => (new RegExp(`;\\s*${p}=([^;>\\s,]+)`, 'i').exec(v) || [])[1] || '';
const uriDe = v => (/<([^>]+)>/.exec(v) || [, v.split(';')[0]])[1].trim();
const usuarioDe = v => (/sip:([^@;>]+)@/i.exec(v) || [])[1] || '';
const cseqNum = msg => parseInt(uno(msg, 'cseq'), 10) || 0;
const cseqMet = msg => (uno(msg, 'cseq').split(/\s+/)[1] || '').toUpperCase();

/** Desafío Digest (MD5, con o sin qop=auth). */
export function digest({ usuario, clave, metodo, uri, desafio, nc = 1, cnonce: cn }) {
  const v = n => (new RegExp(`${n}="?([^",]+)"?`, 'i').exec(desafio) || [])[1] || '';
  const realm = v('realm'), nonce = v('nonce'), opaque = v('opaque'), qop = /qop="?([^"]*)"?/i.exec(desafio)?.[1]?.split(',').map(s => s.trim()).includes('auth') ? 'auth' : '';
  const ha1 = md5(`${usuario}:${realm}:${clave}`), ha2 = md5(`${metodo}:${uri}`);
  const cnonce = cn || azar(8), ncs = String(nc).padStart(8, '0');
  const resp = qop ? md5(`${ha1}:${nonce}:${ncs}:${cnonce}:${qop}:${ha2}`) : md5(`${ha1}:${nonce}:${ha2}`);
  let s = `Digest username="${usuario}", realm="${realm}", nonce="${nonce}", uri="${uri}", response="${resp}", algorithm=MD5`;
  if (qop) s += `, qop=${qop}, nc=${ncs}, cnonce="${cnonce}"`;
  if (opaque) s += `, opaque="${opaque}"`;
  return s;
}

/** SDP: oferta/respuesta de audio G.711. */
export function sdp({ ip, puerto, pts = [8, 0] }) {
  const id = Date.now();
  return ['v=0', `o=impar ${id} ${id} IN IP4 ${ip}`, 's=IMPAR', `c=IN IP4 ${ip}`, 't=0 0',
    `m=audio ${puerto} RTP/AVP ${pts.join(' ')} 101`, ...pts.map(p => `a=rtpmap:${p} ${CODECS[p].nombre}/8000`),
    'a=rtpmap:101 telephone-event/8000', 'a=fmtp:101 0-15', 'a=ptime:20', 'a=sendrecv', ''].join('\r\n');
}
export function leerSDP(texto) {
  const ip = (/^c=IN IP4 (\S+)/m.exec(texto) || [])[1];
  const m = /^m=audio (\d+) \S+ ([\d ]+)/m.exec(texto);
  if (!ip || !m) return null;
  const pts = m[2].trim().split(/\s+/).map(Number);
  return { ip, puerto: +m[1], pt: pts.find(p => CODECS[p]) ?? null, pts };
}

/** Número que manda el CRM («+595981…») → lo que marca la central. */
/** Formatos para números de Paraguay: local 0981123456 · nacional 981123456 · internacional 595981123456 · mas +595981123456 · 00 00595981123456 */
export const FORMATOS = ['local', 'nacional', 'internacional', 'mas', '00'];
export function numeroCentral(n, { prefijoSalida = '', prefijoInternacional = '00', formato = 'local' } = {}) {
  const s = String(n || '').trim(); const d = s.replace(/\D/g, '');
  let r = d;
  if (s.startsWith('+')) {
    if (d.startsWith('595')) {
      const resto = d.slice(3);
      r = { nacional: resto, internacional: '595' + resto, mas: '+595' + resto, '00': '00595' + resto }[formato] ?? '0' + resto;
    } else r = formato === 'mas' ? '+' + d : prefijoInternacional + d;
  }
  return prefijoSalida + r;
}

function ipLocal() {
  for (const lista of Object.values(os.networkInterfaces())) for (const i of lista || []) if (i.family === 'IPv4' && !i.internal) return i.address;
  return '127.0.0.1';
}

export class TelefoniaSIP extends EventEmitter {
  constructor(c = {}) {
    super();
    this.servidor = c.servidor; this.puerto = +(c.puerto || 5060); this.usuario = String(c.usuario || ''); this.clave = String(c.clave || '');
    this.dominio = c.dominio || this.servidor; this.puertoLocal = +(c.puertoLocal || 5062);
    this.ip = c.ipPublica || ipLocal(); this.puertoContacto = this.puertoLocal;
    this.rtpDesde = +(c.rtpDesde || 40000); this.rtpHasta = +(c.rtpHasta || 40100);
    this.prefijos = { prefijoSalida: c.prefijoSalida || '', prefijoInternacional: c.prefijoInternacional || '00', formato: FORMATOS.includes(String(c.formato || '').toLowerCase()) ? String(c.formato).toLowerCase() : 'local' };
    this.expira = +(c.expira || 300);
    this.ag = null; // «registrado» (mismo nombre que la telefonía por Bluetooth)
    this.trans = new Map(); this.llamadas = new Map(); this.cseqReg = 0; this.callIdReg = azar(12) + '@impar';
    this.tagReg = azar(6); this.nc = 0;
  }
  get nombre() { return `Central ${this.servidor} · interno ${this.usuario}`; }
  aviso(m) { this.emit('aviso', m); }

  /* ---------- transporte ---------- */
  async abrir() {
    if (this.sock) return;
    if (!this.servidor || !this.usuario || !this.clave) throw new Error('Faltan SIP_SERVIDOR, SIP_USUARIO o SIP_CLAVE en pasarela.env.');
    this.sock = dgram.createSocket('udp4');
    await new Promise((ok, mal) => { this.sock.once('error', mal); this.sock.bind(this.puertoLocal, ok); });
    this.sock.on('error', e => this.aviso('SIP: ' + e.message));
    this.sock.on('message', (b, r) => { if (!b.toString('latin1').trim()) return; try { this.recibir(analizar(b.toString('latin1')), r); } catch (e) { this.aviso('SIP: mensaje inválido (' + e.message + ')'); } });
  }
  mandar(texto, ip = this.servidor, puerto = this.puerto) { this.sock?.send(Buffer.from(texto, 'latin1'), puerto, ip); }
  via(branch) { return `SIP/2.0/UDP ${this.ip}:${this.puertoContacto};rport;branch=${branch}`; }
  contacto() { return `<sip:${this.usuario}@${this.ip}:${this.puertoContacto};transport=udp>`; }
  armar(primera, cab, cuerpo = '') {
    const l = [primera, ...cab.filter(Boolean)];
    if (cuerpo) l.push('Content-Type: application/sdp');
    l.push('User-Agent: IMPAR-Pasarela/0.2', `Content-Length: ${Buffer.byteLength(cuerpo, 'latin1')}`, '', cuerpo);
    return l.join('\r\n');
  }
  /** Transacción cliente: reintenta por UDP y resuelve con la respuesta final (y avisa las provisorias). */
  pedir(texto, branch, { invite = false, provisoria = () => {}, destino } = {}) {
    return new Promise(ok => {
      const tr = { ok, provisoria, invite, intervalo: T1, recibio: false, destino };
      const reenviar = () => {
        if (tr.recibio && invite) return;
        this.mandar(texto, ...(destino || []));
        tr.intervalo = invite ? tr.intervalo * 2 : Math.min(tr.intervalo * 2, T2);
        tr.timer = setTimeout(reenviar, tr.intervalo);
      };
      tr.limite = setTimeout(() => { clearTimeout(tr.timer); this.trans.delete(branch); ok(null); }, 32000);
      this.trans.set(branch, tr); reenviar();
    });
  }

  /* ---------- registro ---------- */
  async registrar(auth = null, intento = 0) {
    const branch = 'z9hG4bK' + azar(8), uri = `sip:${this.dominio}`;
    const r = await this.pedir(this.armar(`REGISTER ${uri} SIP/2.0`, [
      `Via: ${this.via(branch)}`, 'Max-Forwards: 70', `From: <sip:${this.usuario}@${this.dominio}>;tag=${this.tagReg}`, `To: <sip:${this.usuario}@${this.dominio}>`,
      `Call-ID: ${this.callIdReg}`, `CSeq: ${++this.cseqReg} REGISTER`, `Contact: ${this.contacto()};expires=${this.expira}`, `Expires: ${this.expira}`,
      'Allow: INVITE, ACK, CANCEL, BYE, OPTIONS, INFO, UPDATE', auth && `${auth.cab}: ${auth.valor}`]), branch);
    if (!r) return this.marcarRegistro(false, 'La central no responde. Revisá SIP_SERVIDOR, SIP_PUERTO y que el router deje pasar el puerto.');
    if ((r.codigo === 401 || r.codigo === 407) && intento < 2) {
      const cab = r.codigo === 401 ? 'Authorization' : 'Proxy-Authorization';
      const desafio = uno(r, r.codigo === 401 ? 'www-authenticate' : 'proxy-authenticate');
      return this.registrar({ cab, valor: digest({ usuario: this.usuario, clave: this.clave, metodo: 'REGISTER', uri, desafio }) }, intento + 1);
    }
    if (r.codigo >= 200 && r.codigo < 300) {
      const exp = parseInt(param(uno(r, 'contact'), 'expires') || uno(r, 'expires') || this.expira, 10) || this.expira;
      this.marcarRegistro(true);
      clearTimeout(this.tReg); this.tReg = setTimeout(() => this.registrar(), Math.max(30, exp * 0.8) * 1000);
      return true;
    }
    return this.marcarRegistro(false, r.codigo === 401 || r.codigo === 403 ? 'La central rechazó el usuario o la contraseña del interno.' : `La central respondió ${r.codigo} ${r.razon}.`);
  }
  marcarRegistro(ok, motivo) {
    const antes = this.ag; this.ag = ok ? this.nombre : null;
    if (ok && !antes) this.aviso(`Registrada en la central como interno ${this.usuario}.`);
    if (!ok && motivo !== this.ultimoMotivo) this.aviso(motivo);   // cada motivo nuevo se avisa una vez
    this.ultimoMotivo = ok ? null : motivo;
    if (!!antes !== ok) this.emit('equipo', { celular: ok });
    if (!ok) { clearTimeout(this.tReg); this.tReg = setTimeout(() => this.registrar(), 60000); }
    return ok;
  }
  async iniciar() {
    await this.abrir();
    await this.registrar();
    // Mantiene abierto el NAT entre registros.
    this.tVivo = setInterval(() => this.mandar('\r\n\r\n'), 25000);
  }
  async revisar() {
    try { await this.abrir(); await this.registrar(); } catch (e) { this.aviso(e.message); }
    clearTimeout(this.tReg);
  }

  /* ---------- recepción ---------- */
  recibir(msg, r) {
    if (msg.respuesta) {
      const via = uno(msg, 'via'), branch = param(via, 'branch');
      // La central nos dice cómo nos ve (útil detrás de NAT).
      const rec = param(via, 'received'), rport = param(via, 'rport');
      if (rec && rport && (rec !== this.ip || +rport !== this.puertoContacto)) { this.ip = rec; this.puertoContacto = +rport; }
      const tr = this.trans.get(branch);
      if (!tr) { if (msg.codigo >= 200 && msg.codigo < 300 && cseqMet(msg) === 'INVITE') this.reAck(msg); return; }
      if (msg.codigo < 200) { tr.recibio = true; clearTimeout(tr.timer); tr.provisoria(msg); return; }
      clearTimeout(tr.timer); clearTimeout(tr.limite); this.trans.delete(branch); tr.ok(msg);
      return;
    }
    const met = msg.metodo;
    if (met === 'INVITE') return this.invitacion(msg, r);
    if (met === 'ACK') return this.ack(msg);
    if (met === 'CANCEL') return this.cancelacion(msg, r);
    if (met === 'BYE') { this.responder(msg, r, 200, 'OK'); const ll = this.llamadas.get(uno(msg, 'call-id')); if (ll) this.finalizar(ll); return; }
    if (['OPTIONS', 'INFO', 'UPDATE', 'NOTIFY'].includes(met)) return this.responder(msg, r, 200, 'OK');
    return this.responder(msg, r, 405, 'Method Not Allowed');
  }
  responder(req, r, codigo, razon, { tag, cuerpo = '', extra = [] } = {}) {
    let to = uno(req, 'to'); if (tag && !/;tag=/.test(to)) to += `;tag=${tag}`;
    const texto = this.armar(`SIP/2.0 ${codigo} ${razon}`, [...(req.h.via || []).map(v => `Via: ${v}`), ...(req.h['record-route'] || []).map(v => `Record-Route: ${v}`),
      `From: ${uno(req, 'from')}`, `To: ${to}`, `Call-ID: ${uno(req, 'call-id')}`, `CSeq: ${uno(req, 'cseq')}`,
      codigo >= 200 && codigo < 300 && req.metodo === 'INVITE' ? `Contact: ${this.contacto()}` : '', ...extra], cuerpo);
    const via = uno(req, 'via'), rp = param(via, 'rport');
    this.mandar(texto, r.address, rp && /^\d+$/.test(rp) ? +rp : r.port);
    return texto;
  }

  /* ---------- llamadas entrantes ---------- */
  async invitacion(req, r) {
    const id = uno(req, 'call-id'), existente = this.llamadas.get(id);
    if (existente) {
      if (existente.branchInv === param(uno(req, 'via'), 'branch')) { if (existente.ultimaResp) this.mandar(existente.ultimaResp, r.address, r.port); return; }
      // re-INVITE (espera, refresco de sesión): se acepta con el mismo audio.
      const s = leerSDP(req.cuerpo); if (s && existente.rtp) existente.rtp.destino(s.ip, s.puerto);
      this.responder(req, r, 200, 'OK', { tag: existente.tagLocal, cuerpo: existente.sdpLocal || '' });
      return;
    }
    if ([...this.llamadas.values()].some(ll => !ll.terminada)) return this.responder(req, r, 486, 'Busy Here');
    const ll = { id, direccion: 'entrante', req, r, tagLocal: azar(6), branchInv: param(uno(req, 'via'), 'branch'), oferta: leerSDP(req.cuerpo),
      remotoUri: uriDe(uno(req, 'contact')) || uriDe(uno(req, 'from')), ruta: (req.h['record-route'] || []).slice(), cseq: 1, cseqRemoto: cseqNum(req) };
    ll.desde = `${uno(req, 'to')};tag=${ll.tagLocal}`.replace(/;tag=[^;]+;tag=/, ';tag='); ll.hacia = uno(req, 'from');
    this.llamadas.set(id, ll);
    this.responder(req, r, 100, 'Trying');
    ll.ultimaResp = this.responder(req, r, 180, 'Ringing', { tag: ll.tagLocal });
    const numero = usuarioDe(uno(req, 'from')) || (/"([^"]+)"/.exec(uno(req, 'from')) || [])[1] || '';
    this.emit('llamada', { ref: id, estado: 'incoming', numero });
  }
  async atender(ref) {
    const ll = this.llamadas.get(ref); if (!ll || ll.direccion !== 'entrante' || ll.atendida) return;
    if (!ll.oferta?.pt && ll.oferta?.pt !== 0) { this.responder(ll.req, ll.r, 488, 'Not Acceptable Here', { tag: ll.tagLocal }); return this.finalizar(ll); }
    ll.rtp = new SesionRTP({ ip: this.ip, desde: this.rtpDesde, hasta: this.rtpHasta, log: m => this.aviso(m) });
    const p = await ll.rtp.abrir(); ll.rtp.destino(ll.oferta.ip, ll.oferta.puerto, ll.oferta.pt);
    ll.sdpLocal = sdp({ ip: this.ip, puerto: p, pts: [ll.oferta.pt] });
    ll.atendida = true;
    ll.ultimaResp = this.responder(ll.req, ll.r, 200, 'OK', { tag: ll.tagLocal, cuerpo: ll.sdpLocal, extra: ['Allow: INVITE, ACK, CANCEL, BYE, OPTIONS, INFO, UPDATE'] });
    // Reenvía el 200 hasta que llegue el ACK.
    let int = T1; const reenviar = () => { if (ll.confirmada || ll.terminada) return; this.mandar(ll.ultimaResp, ll.r.address, ll.r.port); int = Math.min(int * 2, T2); ll.t200 = setTimeout(reenviar, int); };
    ll.t200 = setTimeout(reenviar, int);
    ll.tSinAck = setTimeout(() => { if (!ll.confirmada && !ll.terminada) { this.bye(ll); } }, 32000);
    this.emit('estado', { ref, estado: 'active' });
  }
  ack(req) { const ll = this.llamadas.get(uno(req, 'call-id')); if (ll && !ll.confirmada) { ll.confirmada = true; clearTimeout(ll.t200); clearTimeout(ll.tSinAck); } }
  cancelacion(req, r) {
    this.responder(req, r, 200, 'OK');
    const ll = this.llamadas.get(uno(req, 'call-id'));
    if (ll && ll.direccion === 'entrante' && !ll.atendida) { this.responder(ll.req, ll.r, 487, 'Request Terminated', { tag: ll.tagLocal }); this.finalizar(ll); }
  }

  /* ---------- llamadas salientes ---------- */
  async marcar(numero) {
    await this.abrir();
    if (!this.ag) throw new Error('La pasarela no está registrada en la central.');
    const destino = numeroCentral(numero, this.prefijos);
    if (!/^\d{3,20}$/.test(destino)) throw new Error('Número inválido para la central.');
    const id = azar(12) + '@impar';
    const ll = { id, direccion: 'saliente', tagLocal: azar(6), cseq: 1, uri: `sip:${destino}@${this.dominio}` };
    ll.desde = `<sip:${this.usuario}@${this.dominio}>;tag=${ll.tagLocal}`; ll.hacia = `<${ll.uri}>`;
    ll.rtp = new SesionRTP({ ip: this.ip, desde: this.rtpDesde, hasta: this.rtpHasta, log: m => this.aviso(m) });
    const p = await ll.rtp.abrir();
    ll.sdpLocal = sdp({ ip: this.ip, puerto: p });
    this.llamadas.set(id, ll);
    this.emit('llamada', { ref: id, estado: 'dialing' });
    this.invitar(ll).catch(e => { this.aviso('SIP: ' + e.message); this.finalizar(ll); });
    return id;
  }
  async invitar(ll, auth = null, intento = 0) {
    const branch = 'z9hG4bK' + azar(8); ll.branchInv = branch; ll.cseqInv = ll.cseq;
    const texto = this.armar(`INVITE ${ll.uri} SIP/2.0`, [`Via: ${this.via(branch)}`, 'Max-Forwards: 70', `From: ${ll.desde}`, `To: ${ll.hacia}`,
      `Call-ID: ${ll.id}`, `CSeq: ${ll.cseq} INVITE`, `Contact: ${this.contacto()}`, 'Allow: INVITE, ACK, CANCEL, BYE, OPTIONS, INFO, UPDATE',
      auth && `${auth.cab}: ${auth.valor}`], ll.sdpLocal);
    ll.invTexto = texto;
    const fin = await this.pedir(texto, branch, { invite: true, provisoria: msg => {
      if (ll.terminada) return;
      if (msg.codigo === 180 || msg.codigo === 183) {
        const s = leerSDP(msg.cuerpo); if (s) ll.rtp.destino(s.ip, s.puerto, s.pt);
        if (!ll.sono) { ll.sono = true; this.emit('estado', { ref: ll.id, estado: 'alerting' }); }
      }
      ll.provisoria = true;
    } });
    if (ll.terminada && !fin) return;
    if (!fin) { this.aviso('La central no respondió la llamada.'); return this.finalizar(ll); }
    if (fin.codigo >= 300) this.ackError(ll, fin, branch);
    if ((fin.codigo === 401 || fin.codigo === 407) && intento < 2 && !ll.terminada) {
      ll.cseq++;
      const cab = fin.codigo === 401 ? 'Authorization' : 'Proxy-Authorization';
      const desafio = uno(fin, fin.codigo === 401 ? 'www-authenticate' : 'proxy-authenticate');
      return this.invitar(ll, { cab, valor: digest({ usuario: this.usuario, clave: this.clave, metodo: 'INVITE', uri: ll.uri, desafio }) }, intento + 1);
    }
    if (fin.codigo >= 200 && fin.codigo < 300) {
      ll.hacia = uno(fin, 'to'); ll.remotoUri = uriDe(uno(fin, 'contact')) || ll.uri; ll.ruta = (fin.h['record-route'] || []).slice().reverse();
      const s = leerSDP(fin.cuerpo); if (s) ll.rtp.destino(s.ip, s.puerto, s.pt);
      ll.ok200 = fin; this.mandarAck(ll);
      if (ll.terminada) return this.bye(ll);
      ll.confirmada = true; ll.atendida = true;
      this.emit('estado', { ref: ll.id, estado: 'active' });
      return;
    }
    if (fin.codigo >= 300) { if (!ll.terminada) this.aviso(`La central no completó la llamada (${fin.codigo} ${fin.razon}).`); this.finalizar(ll); }
  }
  ackError(ll, fin, branch) {
    this.mandar(this.armar(`ACK ${ll.uri} SIP/2.0`, [`Via: ${this.via(branch)}`, 'Max-Forwards: 70', `From: ${ll.desde}`, `To: ${uno(fin, 'to')}`,
      `Call-ID: ${ll.id}`, `CSeq: ${ll.cseqInv} ACK`]));
  }
  mandarAck(ll) {
    ll.ackTexto = this.armar(`ACK ${ll.remotoUri} SIP/2.0`, [`Via: ${this.via('z9hG4bK' + azar(8))}`, 'Max-Forwards: 70', ...ll.ruta.map(x => `Route: ${x}`),
      `From: ${ll.desde}`, `To: ${ll.hacia}`, `Call-ID: ${ll.id}`, `CSeq: ${ll.cseqInv} ACK`]);
    this.mandar(ll.ackTexto);
  }
  reAck(msg) { const ll = this.llamadas.get(uno(msg, 'call-id')); if (ll?.ackTexto) this.mandar(ll.ackTexto); }

  /* ---------- cortar ---------- */
  async cortar(ref) {
    const ll = this.llamadas.get(ref); if (!ll || ll.terminada) return;
    if (ll.direccion === 'entrante' && !ll.atendida) { ll.ultimaResp = this.responder(ll.req, ll.r, 486, 'Busy Here', { tag: ll.tagLocal }); return this.finalizar(ll); }
    if (ll.direccion === 'saliente' && !ll.confirmada) {
      ll.terminada = true; // si después llega un 200, se corta con BYE
      if (ll.provisoria) {
        this.mandar(this.armar(`CANCEL ${ll.uri} SIP/2.0`, [`Via: ${this.via(ll.branchInv)}`, 'Max-Forwards: 70', `From: ${ll.desde}`, `To: ${ll.hacia}`,
          `Call-ID: ${ll.id}`, `CSeq: ${ll.cseqInv} CANCEL`]));
      }
      return this.finalizar(ll, true);
    }
    return this.bye(ll);
  }
  async cortarTodas() { for (const id of [...this.llamadas.keys()]) await this.cortar(id); }
  bye(ll) {
    const branch = 'z9hG4bK' + azar(8);
    const destino = ll.direccion === 'entrante' ? [ll.r.address, ll.r.port] : undefined;
    this.pedir(this.armar(`BYE ${ll.remotoUri} SIP/2.0`, [`Via: ${this.via(branch)}`, 'Max-Forwards: 70', ...(ll.ruta || []).map(x => `Route: ${x}`),
      `From: ${ll.desde}`, `To: ${ll.hacia}`, `Call-ID: ${ll.id}`, `CSeq: ${++ll.cseq + (ll.direccion === 'entrante' ? 0 : 0)} BYE`]), branch, { destino });
    this.finalizar(ll, true);
  }
  finalizar(ll, yaMarcada = false) {
    if (ll.cerrada) return; ll.cerrada = true; if (!yaMarcada) ll.terminada = true; else ll.terminada = true;
    clearTimeout(ll.t200); clearTimeout(ll.tSinAck); ll.rtp?.cerrar();
    this.emit('fin', { ref: ll.id });
    setTimeout(() => this.llamadas.delete(ll.id), 32000); // absorbe retransmisiones tardías
  }
  /** Sesión de audio de una llamada (para el puente con el navegador). */
  rtpDe(ref) { return this.llamadas.get(ref)?.rtp || null; }
  detener() { clearTimeout(this.tReg); clearInterval(this.tVivo); try { this.sock?.close(); } catch { /* nada */ } }
}
