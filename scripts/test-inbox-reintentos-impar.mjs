/** IMPAR · Recepción durable: un fallo transitorio de ingesta no manda el
 * mensaje del cliente a cuarentena en segundos. Datos ficticios, sin red ni BD. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const leer = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const fuente = leer('src/worker.mjs').replace(/^import .*\n/gm, '').replace(/^export /gm, '');

function escenario({ falla }) {
  let ahora = 0; // segundos simulados
  const inbox = [];
  const avisos = [], ingresados = [];
  const q = async (sql, p = []) => {
    if (sql.startsWith("UPDATE inbox SET estado='pendiente',error='Multimedia")) return { rows: [], rowCount: 0 };
    if (sql.includes('FROM inbox i')) {
      assert.ok(sql.includes('i.proximo_intento IS NULL OR i.proximo_intento<=now()'), 'Respeta la espera');
      return { rows: inbox.filter(m => m.estado === 'pendiente' && (m.proximo == null || m.proximo <= ahora))
        .map(m => ({ ...m })) };
    }
    if (sql.startsWith('SELECT * FROM empresas')) return { rows: [{ id: 'impar', codigo: 'impar' }] };
    const fila = inbox.find(m => m.id === p[0]);
    if (sql.startsWith("UPDATE inbox SET estado='procesado'")) { fila.estado = 'procesado'; fila.proximo = null; return { rowCount: 1 }; }
    if (sql.startsWith("UPDATE inbox SET estado='cuarentena'")) { fila.estado = 'cuarentena'; fila.intentos = p[1]; fila.proximo = null; return { rowCount: 1 }; }
    if (sql.startsWith('UPDATE inbox SET intentos=$2')) {
      assert.ok(sql.includes('make_interval(secs=>$4)'));
      fila.intentos = p[1]; fila.error = p[2]; fila.proximo = ahora + p[3]; return { rowCount: 1 };
    }
    throw new Error('SQL no esperado en prueba: ' + sql.slice(0, 60));
  };
  const ctx = {
    q, console: { log() {}, warn() {}, error() {} }, setInterval() {},
    ingresarMensaje: async (_e, d) => {
      if (falla(d.extId)) throw new Error('fallo transitorio simulado');
      ingresados.push(d.extId);
    },
    notificar: async (_e, tipo) => { avisos.push(tipo); },
    baileys: {}, meta: {}, emitir() {}, derivarRecepcionesVencidas: async () => {},
    registrarEnvioImpar: async () => {}, drenarWebhooksMeta: async () => {},
    resolverRemitenteWA: async () => null
  };
  const w = vm.runInNewContext(fuente + ';({drenarInbox,MAX_INTENTOS,ESPERAS_INBOX_SEG,esperaInbox})', ctx);
  const agregar = ext => inbox.push({ id: inbox.length + 1, empresa_id: 'impar', canal_id: 'c', tipo: 'whatsapp_qr',
    ext_id: ext, remitente: '595981000001', nombre: 'Cliente', txt: 'Hola', payload: {}, estado: 'pendiente', intentos: 0, proximo: null });
  // Simula el intervalo real de 2 s del worker.
  const correr = async segundos => { for (let t = 0; t < segundos; t += 2) { ahora += 2; await w.drenarInbox(); } };
  return { w, inbox, avisos, ingresados, agregar, correr };
}

// 1) Antes: 3 fallos en ~6 s = cuarentena. Ahora sigue reintentando y entra.
{
  let fallos = 0;
  const e = escenario({ falla: () => fallos++ < 5 });
  e.agregar('A');
  await e.correr(10);
  assert.equal(e.inbox[0].estado, 'pendiente', 'No pasa a cuarentena en segundos');
  await e.correr(60 * 10);
  assert.deepEqual(e.ingresados, ['A'], 'El mensaje termina en la conversación');
  assert.equal(e.inbox[0].estado, 'procesado');
  assert.equal(e.avisos.length, 0, 'Sin aviso de cuarentena');
}

// 2) La espera crece y no se reintenta antes de tiempo.
{
  const e = escenario({ falla: () => true });
  assert.deepEqual([...e.w.ESPERAS_INBOX_SEG], [5, 15, 30, 60, 120, 300, 600, 1200, 1800]);
  assert.equal(e.w.MAX_INTENTOS, 10);
  assert.equal(e.w.esperaInbox(1), 5);
  assert.equal(e.w.esperaInbox(99), 1800);
  const total = e.w.ESPERAS_INBOX_SEG.reduce((a, b) => a + b, 0);
  assert.ok(total >= 3600, 'Cubre al menos una hora de incidencia');
  e.agregar('B');
  await e.correr(2);
  assert.equal(e.inbox[0].intentos, 1);
  await e.correr(2);
  assert.equal(e.inbox[0].intentos, 1, 'Espera antes de reintentar');
  // 3) Un error persistente sí termina en cuarentena visible, con un solo aviso.
  await e.correr(total + 60);
  assert.equal(e.inbox[0].estado, 'cuarentena');
  assert.equal(e.inbox[0].intentos, 10);
  assert.deepEqual(e.avisos, ['cuarentena']);
}

// 4) Un mensaje con fallos no bloquea a los demás clientes.
{
  const e = escenario({ falla: ext => ext === 'roto' });
  e.agregar('roto'); e.agregar('C'); e.agregar('D');
  await e.correr(2);
  assert.deepEqual(e.ingresados, ['C', 'D']);
}

// 5) Migración aditiva que recupera la cuarentena reciente.
{
  const sql = leer('src/migrations/025_inbox_reintentos_impar.sql');
  assert.ok(sql.includes('ADD COLUMN IF NOT EXISTS proximo_intento'));
  assert.ok(sql.includes("WHERE estado='cuarentena' AND ts > now() - interval '7 days'"));
  assert.ok(!/\b(DROP|DELETE|TRUNCATE)\b/i.test(sql), 'No elimina datos');
  const w = leer('src/worker.mjs');
  assert.ok(w.includes("intentos=0, error=NULL, proximo_intento=NULL WHERE empresa_id=$1 AND estado='cuarentena'"),
    'Reprocesar manual limpia la espera');
}

console.log('✔ IMPAR: reintentos escalonados de recepción, sin cuarentena por fallos transitorios.');
