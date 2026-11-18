#!/usr/bin/env node
/**
 * Central IP falsa para probar la pasarela en modo «central» sin un Grandstream real.
 * - Pide usuario y contraseña (Digest) para registrarse y para llamar.
 * - Control por HTTP en 127.0.0.1:PUERTO_CONTROL:
 *     /llamar?num=0981000222  → la central llama al interno registrado
 *     /cortar                 → la central corta la llamada en curso
 *     /estado                 → JSON con registro, llamada y audio recibido
 * Uso: SIP_PUERTO=5070 CONTROL=5071 USUARIO=801 CLAVE=secreta node central_falsa.mjs
 */
import dgram from 'node:dgram';
import http from 'node:http';
import crypto from 'node:crypto';
import { analizar, leerSDP } from '../lib/sip.mjs';
import { linealAAlaw, linealAUlaw } from '../lib/rtp.mjs';

const PUERTO = +(process.env.SIP_PUERTO || 5070), CONTROL = +(process.env.CONTROL || 5071);
const USUARIO = process.env.USUARIO || '801', CLAVE = process.env.CLAVE || 'secreta', REALM = 'impar-prueba';
const md5 = s => crypto.createHash('md5').update(s).digest('hex');
const azar = () => crypto.randomBytes(6).toString('hex');
const sock = dgram.createSocket('udp4');
const st = { registrado: false, contacto: null, llamada: null, rtpRecibidos: 0, marcado: null, registros: 0, autenticaciones: 0 };
const nonces = new Set();
const uno = (m, k) => m.h[k]?.[0] || '';
const log = m => console.log('[central falsa] ' + m);

function desafio() { const n = azar(); nonces.add(n); return `Digest realm="${REALM}", nonce="${n}", qop="auth", algorithm=MD5`; }
function valida(cab, metodo) {
  if (!cab) return false;
  const v = k => (new RegExp(`${k}="?([^",]+)"?`).exec(cab) || [])[1];
  if (v('username') !== USUARIO || !nonces.has(v('nonce'))) return false;
  const ha1 = md5(`${USUARIO}:${REALM}:${CLAVE}`), ha2 = md5(`${metodo}:${v('uri')}`);
  const esperado = v('qop') ? md5(`${ha1}:${v('nonce')}:${v('nc')}:${v('cnonce')}:${v('qop')}:${ha2}`) : md5(`${ha1}:${v('nonce')}:${ha2}`);
  return esperado === v('response');
}
function responder(req, r, codigo, razon, extra = [], cuerpo = '', tag) {
  let to = uno(req, 'to'); if (tag && !/tag=/.test(to)) to += ';tag=' + tag;
  const l = [`SIP/2.0 ${codigo} ${razon}`, ...req.h.via.map(v => `Via: ${v};received=${r.address}`.replace(/;rport(?!=)/, `;rport=${r.port}`)),
    `From: ${uno(req, 'from')}`, `To: ${to}`, `Call-ID: ${uno(req, 'call-id')}`, `CSeq: ${uno(req, 'cseq')}`, ...extra];
  if (cuerpo) l.push('Content-Type: application/sdp');
  l.push(`Content-Length: ${Buffer.byteLength(cuerpo)}`, '', cuerpo);
  sock.send(l.join('\r\n'), r.port, r.address);
}
let rtp = null;
function iniciarRTP(destino, pt, local = 0) {
  pararRTP();
  rtp = dgram.createSocket('udp4'); rtp.bind(local);
  rtp.on('message', () => { st.rtpRecibidos++; });
  let t = 0, sec = 1, ts = 0; const cod = pt === 0 ? linealAUlaw : linealAAlaw;
  rtp.timer = setInterval(() => {
    const b = Buffer.alloc(172); b[0] = 0x80; b[1] = pt; b.writeUInt16BE(sec++ & 0xffff, 2); b.writeUInt32BE(ts, 4); ts += 160; b.writeUInt32BE(0x1234, 8);
    for (let i = 0; i < 160; i++, t++) b[12 + i] = cod(Math.round(Math.sin(2 * Math.PI * 440 * t / 8000) * 9000));
    rtp.send(b, destino.puerto, destino.ip, () => {});
  }, 20);
}
function pararRTP() { if (rtp) { clearInterval(rtp.timer); try { rtp.close(); } catch { /* nada */ } rtp = null; } }
const puertoRTP = () => new Promise(ok => { const s = dgram.createSocket('udp4'); s.bind(0, () => { const p = s.address().port; s.close(); ok(p); }); });
const sdp = (p, pt = 8) => `v=0\r\no=gs 1 1 IN IP4 127.0.0.1\r\ns=GS\r\nc=IN IP4 127.0.0.1\r\nt=0 0\r\nm=audio ${p} RTP/AVP ${pt}\r\na=rtpmap:${pt} ${pt === 0 ? 'PCMU' : 'PCMA'}/8000\r\n`;

sock.on('message', async (b, r) => {
  if (!b.toString('latin1').trim()) return; // mantenimiento de NAT
  const m = analizar(b.toString('latin1'));
  if (!m.respuesta && !m.h.via) return;
  if (m.respuesta) {
    const ll = st.llamada; if (!ll || uno(m, 'call-id') !== ll.id) return;
    if (m.codigo === 180) ll.estado = 'sonando';
    if (m.codigo === 200 && /INVITE/.test(uno(m, 'cseq'))) {
      ll.estado = 'en_curso'; ll.to = uno(m, 'to');
      const s = leerSDP(m.cuerpo);
      sock.send([`ACK sip:${USUARIO}@${r.address}:${r.port} SIP/2.0`, `Via: SIP/2.0/UDP 127.0.0.1:${PUERTO};branch=z9hG4bK${azar()}`, `From: ${ll.from}`, `To: ${ll.to}`,
        `Call-ID: ${ll.id}`, 'CSeq: 1 ACK', 'Content-Length: 0', '', ''].join('\r\n'), r.port, r.address);
      if (s) iniciarRTP(s, s.pt ?? 8, ll.p);
    }
    if (m.codigo >= 400 && /INVITE/.test(uno(m, 'cseq'))) { ll.estado = 'rechazada ' + m.codigo; st.llamada = null; }
    return;
  }
  const met = m.metodo;
  if (met === 'REGISTER') {
    st.registros++;
    if (!valida(uno(m, 'authorization'), 'REGISTER')) return responder(m, r, 401, 'Unauthorized', [`WWW-Authenticate: ${desafio()}`]);
    st.autenticaciones++; st.registrado = true; st.contacto = { ip: r.address, puerto: r.port };
    return responder(m, r, 200, 'OK', [`Contact: ${uno(m, 'contact').replace(/;expires=\d+/, '')};expires=60`]);
  }
  if (met === 'INVITE') {
    if (st.llamada && st.llamada.id === uno(m, 'call-id') && st.llamada.estado !== 'autenticando') return;
    if (!valida(uno(m, 'proxy-authorization'), 'INVITE')) {
      st.llamada = { id: uno(m, 'call-id'), estado: 'autenticando' };
      return responder(m, r, 407, 'Proxy Authentication Required', [`Proxy-Authenticate: ${desafio()}`], '', azar());
    }
    st.marcado = (/sip:([^@]+)@/.exec(m.uri) || [])[1];
    const tag = azar(), s = leerSDP(m.cuerpo);
    st.llamada = { id: uno(m, 'call-id'), estado: 'sonando', saliente: true, r, from: uno(m, 'from'), tag };
    responder(m, r, 100, 'Trying');
    responder(m, r, 180, 'Ringing', [], '', tag);
    const p = await puertoRTP();
    setTimeout(() => {
      if (st.llamada?.id !== uno(m, 'call-id')) return;
      st.llamada.estado = 'en_curso';
      responder(m, r, 200, 'OK', [`Contact: <sip:${st.marcado}@127.0.0.1:${PUERTO}>`], sdp(p, s?.pt ?? 8), tag);
      if (s) iniciarRTP(s, s.pt ?? 8, p);
    }, 1500);
    return;
  }
  if (met === 'ACK') return;
  if (met === 'CANCEL') { responder(m, r, 200, 'OK'); if (st.llamada?.id === uno(m, 'call-id')) { st.llamada.estado = 'cancelada'; st.llamada = null; } return; }
  if (met === 'BYE') { responder(m, r, 200, 'OK'); if (st.llamada?.id === uno(m, 'call-id')) { st.llamada = null; pararRTP(); log('La pasarela cortó la llamada.'); } return; }
  responder(m, r, 200, 'OK');
});

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/llamar' && st.contacto) {
    const id = azar() + '@central', p = await puertoRTP(), tag = azar();
    const from = `"${u.searchParams.get('num') || '0981000222'}" <sip:${u.searchParams.get('num') || '0981000222'}@127.0.0.1>;tag=${tag}`;
    st.llamada = { id, estado: 'llamando', from, entrante: true, p };
    const cuerpo = sdp(p);
    sock.send([`INVITE sip:${USUARIO}@${st.contacto.ip}:${st.contacto.puerto} SIP/2.0`, `Via: SIP/2.0/UDP 127.0.0.1:${PUERTO};branch=z9hG4bK${azar()}`,
      `From: ${from}`, `To: <sip:${USUARIO}@127.0.0.1>`, `Call-ID: ${id}`, 'CSeq: 1 INVITE', `Contact: <sip:central@127.0.0.1:${PUERTO}>`,
      'Content-Type: application/sdp', `Content-Length: ${Buffer.byteLength(cuerpo)}`, '', cuerpo].join('\r\n'), st.contacto.puerto, st.contacto.ip);
  }
  if (u.pathname === '/cortar' && st.llamada) {
    const ll = st.llamada, dest = ll.saliente ? ll.r : { address: st.contacto.ip, port: st.contacto.puerto };
    const from = ll.saliente ? `<sip:${st.marcado}@127.0.0.1>;tag=${ll.tag}` : ll.from, to = ll.saliente ? ll.from : (ll.to || `<sip:${USUARIO}@127.0.0.1>`);
    sock.send([`BYE sip:${USUARIO}@${dest.address}:${dest.port} SIP/2.0`, `Via: SIP/2.0/UDP 127.0.0.1:${PUERTO};branch=z9hG4bK${azar()}`, `From: ${from}`, `To: ${to}`,
      `Call-ID: ${ll.id}`, 'CSeq: 2 BYE', 'Content-Length: 0', '', ''].join('\r\n'), dest.port, dest.address);
    st.llamada = null; pararRTP();
  }
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ ...st, contacto: !!st.contacto, llamada: st.llamada && { estado: st.llamada.estado, saliente: !!st.llamada.saliente } }));
}).listen(CONTROL, '127.0.0.1');
sock.bind(PUERTO, () => log(`escuchando SIP en ${PUERTO}, control en ${CONTROL}`));
