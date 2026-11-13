#!/usr/bin/env node
/**
 * IMPAR · Pasarela telefónica.
 * Corre en una computadora Linux de la sucursal, emparejada por Bluetooth con un celular que tiene
 * el chip de IMPAR. Avisa al CRM las llamadas entrantes, marca las salientes que pide el CRM y
 * lleva el audio entre el celular y el navegador del agente.
 * Nunca escribe números de teléfono en los registros.
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Telefonia } from './lib/telefonia.mjs';
import { PuenteAudio, dispositivosTono, lanzarTono } from './lib/audio.mjs';
import { CRM } from './lib/crm.mjs';

const VERSION = '0.1.0';
const aqui = dirname(fileURLToPath(import.meta.url));
// Configuración: variables de entorno o el archivo pasarela.env junto al programa.
const archivo = join(aqui, 'pasarela.env');
if (existsSync(archivo)) for (const l of readFileSync(archivo, 'utf8').split('\n')) {
  const m = /^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(l); if (m && !l.trim().startsWith('#') && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const log = m => console.log(`[pasarela ${new Date().toLocaleTimeString('es-PY')}] ${m}`);
const iceServers = [{ urls: process.env.STUN_URL || 'stun:stun.l.google.com:19302' }];
if (process.env.TURN_URL) iceServers.push({ urls: process.env.TURN_URL, username: process.env.TURN_USUARIO || '', credential: process.env.TURN_CLAVE || '' });

const wrtc = (await import('@roamhq/wrtc')).default;
const crm = new CRM({ url: process.env.CRM_URL, token: process.env.PASARELA_TOKEN, log });
const tel = new Telefonia();
const llamadas = new Map();   // call_id → { ref, direccion, puente, atenderCRM }
const porRef = new Map();     // ruta D-Bus → call_id
let marcando = null;          // call_id saliente esperando que el celular cree la llamada
const terminadasAntes = new Set(); // llamadas que cortaron antes de que el CRM respondiera

const enviar = ev => crm.enviar(ev).catch(e => { log(`No se pudo avisar «${ev.tipo}» al CRM: ${e.message}`); return null; });
const equipo = () => enviar({ tipo: 'equipo', celular: !!tel.ag, version: VERSION });

async function iniciarAudio(id) {
  const ll = llamadas.get(id); if (!ll || ll.puente) return;
  const tono = process.env.PASARELA_AUDIO === 'tono';
  ll.puente = new PuenteAudio({ wrtc, iceServers, log, ...(tono ? { dispositivos: dispositivosTono, lanzar: lanzarTono } : {}) });
  try { const sdp = await ll.puente.iniciar(); if (llamadas.has(id)) await enviar({ tipo: 'oferta', call_id: id, sdp }); }
  catch (e) { log('Audio: ' + e.message); enviar({ tipo: 'error', call_id: id, mensaje: e.message }); tel.cortar(ll.ref).catch(() => {}); }
}
function terminar(id) {
  const ll = llamadas.get(id); if (!ll) return;
  ll.puente?.cerrar(); llamadas.delete(id); if (ll.ref) porRef.delete(ll.ref);
}

tel.on('aviso', log);
tel.on('equipo', e => { log(e.celular ? 'Celular conectado por Bluetooth.' : 'Sin celular conectado por Bluetooth.'); equipo(); });
tel.on('llamada', async ({ ref, estado, numero }) => {
  if (estado === 'incoming' || estado === 'waiting') {
    log('Llamada entrante.'); // el número viaja solo al CRM, nunca al registro
    const r = await enviar({ tipo: 'entrante', numero });
    if (r?.call_id) {
      llamadas.set(r.call_id, { ref, direccion: 'entrante' }); porRef.set(ref, r.call_id);
      if (terminadasAntes.delete(ref)) { enviar({ tipo: 'fin', call_id: r.call_id }); terminar(r.call_id); }
    }
  } else if (marcando && (estado === 'dialing' || estado === 'alerting' || estado === 'active')) {
    const id = marcando; marcando = null;
    const ll = llamadas.get(id); if (!ll) return;
    ll.ref = ref; porRef.set(ref, id);
    log('Llamada saliente en curso.');
    enviar({ tipo: 'estado', call_id: id, estado });
    iniciarAudio(id); // el agente escucha el tono de llamada desde el principio
  }
});

tel.on('estado', ({ ref, estado }) => {
  const id = porRef.get(ref); if (!id) return;
  const ll = llamadas.get(id);
  enviar({ tipo: 'estado', call_id: id, estado });
  if (estado === 'active' && ll && ll.direccion === 'entrante' && ll.atenderCRM) iniciarAudio(id);
});
tel.on('fin', ({ ref }) => {
  const id = porRef.get(ref);
  if (!id) { terminadasAntes.add(ref); setTimeout(() => terminadasAntes.delete(ref), 60000); return; }
  log('Llamada terminada.');
  enviar({ tipo: 'fin', call_id: id });
  terminar(id);
});

async function comando(c) {
  const id = String(c.call_id || ''), ll = llamadas.get(id);
  try {
    if (c.accion === 'llamar') {
      if (marcando || [...llamadas.values()].some(x => x.puente)) throw new Error('Ya hay una llamada en curso en el celular.');
      llamadas.set(id, { direccion: 'saliente' }); marcando = id;
      log('Marcando un número pedido por el CRM.');
      await tel.marcar(String(c.numero || ''));
      setTimeout(() => { if (marcando === id) { marcando = null; enviar({ tipo: 'error', call_id: id, mensaje: 'El celular no inició la llamada.' }); terminar(id); } }, 15000);
    } else if (c.accion === 'atender' && ll?.ref) { ll.atenderCRM = true; await tel.atender(ll.ref); }
    else if (c.accion === 'respuesta' && ll?.puente) await ll.puente.respuesta(String(c.sdp || ''));
    else if ((c.accion === 'cortar' || c.accion === 'rechazar')) {
      if (ll?.ref) await tel.cortar(ll.ref);
      else if (marcando === id) { marcando = null; await tel.cortarTodas(); enviar({ tipo: 'fin', call_id: id }); terminar(id); }
    }
  } catch (e) {
    log(`No se pudo «${c.accion}»: ${e.message}`);
    if (id) enviar({ tipo: 'error', call_id: id, mensaje: e.message });
    if (c.accion === 'llamar') { marcando = null; terminar(id); }
  }
}

if (process.argv.includes('--probar')) {
  // Diagnóstico: revisa el celular y el audio sin llamar a nadie.
  await tel.revisar();
  log(tel.ag ? 'Telefonía: celular conectado.' : 'Telefonía: no se ve ningún celular. Emparejalo con «bluetoothctl» y revisá que PipeWire sea 1.4 o superior.');
  try { const r = await crm.enviar({ tipo: 'equipo', celular: !!tel.ag, version: VERSION }); log('CRM: conexión y token correctos.'); void r; }
  catch (e) { log('CRM: ' + e.message); }
  process.exit(0);
}

log(`Pasarela telefónica IMPAR ${VERSION} iniciando.`);
tel.iniciar();
setInterval(equipo, 30000);
crm.escuchar(comando, equipo);
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => { log('Deteniendo.'); for (const id of [...llamadas.keys()]) terminar(id); process.exit(0); });
