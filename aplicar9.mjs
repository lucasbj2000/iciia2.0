#!/usr/bin/env node
/**
 * Parche 9 · iciia2.0 — conexión estable de WhatsApp
 *  - Corrige «estabaConectado is not defined» (error del parche 1): al desconectarse,
 *    la línea ahora se reconecta bien y, si WhatsApp la desvincula, borra la sesión vieja.
 *  - Guarda los mensajes enviados para reenviarlos cuando el teléfono del cliente
 *    no los pudo descifrar (evita «Esperando el mensaje»).
 *  - Caché de claves de cifrado y control de reintentos, como recomienda Baileys.
 * Uso:  node aplicar9.mjs && pm2 restart iciia-crm
 */
import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';

const REL = 'src/channels/baileys.mjs';
const p = join(process.cwd(), REL);
console.log('\n══ Parche 9 · conexión estable de WhatsApp ══\n');
if (!existsSync(p)) { console.error(`✖ No existe ${REL}. Corré el script desde /opt/iciia-crm\n`); process.exit(1); }

let s = readFileSync(p, 'utf8');
const original = s;
let errores = 0;
const mal = m => { console.error('  ✖ ' + m); errores++; };

/* 1. Definir estabaConectado donde corresponde (antes de marcar la línea como desconectada) */
if (s.includes('estabaConectado') && !/const\s+estabaConectado\b/.test(s)) {
  const re = /if \(connection === 'close'\) \{[ \t]*\r?\n/;
  if (!re.test(s)) mal('no se encontró el bloque de desconexión');
  else {
    s = s.replace(re, m => m + "          const estabaConectado = S.estado === 'conectado';   // FIX_ESTABA\n");
    const iDef = s.indexOf('const estabaConectado'), iEstado = s.indexOf("S.estado = 'desconectado'", iDef - 400);
    if (iDef < 0 || iEstado < iDef) mal('la definición no quedó antes del cambio de estado');
    else console.log('  ✔ corregido «estabaConectado is not defined»');
  }
} else console.log('  · estabaConectado: no hacía falta corregir');

/* 2. Sesión estable */
if (s.includes('SESION_ESTABLE')) console.log('  · sesión estable: ya aplicado');
else {
  const pasos = [
    ['      auth: state,',
     `      auth: { creds: state.creds, keys: clavesConCache(mod, state.keys) },   // SESION_ESTABLE
      getMessage: async key => enviadosCache.get(key?.id),
      msgRetryCounterCache: reintentos,`, 'opciones del socket'],
    ['    S.sock = sock;',
     `    S.sock = sock;
    // Recordar lo enviado: WhatsApp lo pide de nuevo si el teléfono del cliente no lo pudo descifrar
    const enviarOriginal = sock.sendMessage.bind(sock);
    sock.sendMessage = async (...args) => {
      const r = await enviarOriginal(...args);
      recordar(r?.key?.id, r?.message);
      return r;
    };`, 'registro de enviados']
  ];
  for (const [viejo, nuevo, et] of pasos) {
    if (!s.includes(viejo)) { mal(`no se encontró «${et}»`); continue; }
    s = s.replace(viejo, nuevo);
  }
  s += `

/* SESION_ESTABLE ------------------------------------------------------------ */
const enviadosCache = new Map();
function recordar(id, message) {
  if (!id || !message) return;
  enviadosCache.set(id, message);
  if (enviadosCache.size > 3000) enviadosCache.delete(enviadosCache.keys().next().value);
}
const reintentos = (() => {
  const m = new Map();
  return {
    get: k => m.get(k),
    set: (k, v) => { m.set(k, v); if (m.size > 5000) m.delete(m.keys().next().value); },
    del: k => m.delete(k),
    flushAll: () => m.clear()
  };
})();
const loggerMudo = { level: 'silent', child() { return loggerMudo; },
  trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {} };
function clavesConCache(mod, keys) {
  try {
    return typeof mod.makeCacheableSignalKeyStore === 'function' ? mod.makeCacheableSignalKeyStore(keys, loggerMudo) : keys;
  } catch (e) { return keys; }
}
`;
  if (!errores) console.log('  ✔ sesión estable (reenvío de mensajes, caché de claves y reintentos)');
}

console.log(`\n${'─'.repeat(44)}`);
if (errores) { console.error(`  ✖ ${errores} error(es). No se modificó el archivo.\n  Pegá esta salida para revisarla.\n`); process.exit(1); }
if (s === original) { console.log('  Nada para cambiar: ya estaba aplicado.\n'); process.exit(0); }
if (!existsSync(p + '.orig9')) copyFileSync(p, p + '.orig9');
writeFileSync(p, s, 'utf8');
console.log(`  ✔ ${REL} actualizado\n${'─'.repeat(44)}\n\nAhora seguí los pasos de reconexión limpia.\n`);
