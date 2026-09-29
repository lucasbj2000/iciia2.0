#!/usr/bin/env node
/**
 * Diagnóstico de un cliente: qué pasó con sus mensajes y negociaciones.
 *   node --env-file=.env diag.mjs 0976586543
 * Unir un contacto duplicado (creado por WhatsApp LID) con el cliente real:
 *   node --env-file=.env diag.mjs 0976586543 --unir <id-del-contacto-duplicado>
 */
import pg from 'pg';

const [, , telArg, flag, idDup] = process.argv;
if (!telArg) { console.log('Uso: node --env-file=.env diag.mjs <teléfono> [--unir <id>]'); process.exit(1); }
if (!process.env.DATABASE_URL) { console.error('✖ Falta DATABASE_URL. Corré el comando desde /opt/iciia-crm con --env-file=.env'); process.exit(1); }

const norm = t => { let d = String(t || '').replace(/\D/g, '').replace(/^0+/, ''); if (d.startsWith('595')) d = d.slice(3); return d.replace(/^0+/, ''); };
const n = norm(telArg);
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const q = (s, p) => db.query(s, p);
const f = d => d ? new Date(d).toLocaleString('es-PY') : '—';
const hallazgos = [];

try {
  if (flag === '--unir') { await unir(); } else {

  console.log(`\n══ Diagnóstico · ${telArg} (normalizado: ${n}) ══`);

  /* Contactos con ese número */
  const { rows: cs } = await q(
    `SELECT c.id, c.nombre, c.tel, c.tel_norm, c.externos, c.creado, e.nombre AS empresa
       FROM contactos c JOIN empresas e ON e.id=c.empresa_id
      WHERE c.tel_norm=$1 OR c.externos::text LIKE '%'||$1||'%' ORDER BY c.creado`, [n]);
  console.log(`\n▸ Contactos con ese número: ${cs.length}`);
  for (const c of cs) {
    console.log(`  · ${c.nombre} · tel «${c.tel}» · empresa ${c.empresa}\n    id ${c.id}\n    identidades ${JSON.stringify(c.externos)}`);
    const { rows: ns } = await q(
      `SELECT n.id, n.etapa, n.creado, n.actualizado,
              (SELECT MAX(ts) FROM mensajes m WHERE m.negociacion_id=n.id AND m.dir='in') AS ultimo_in
         FROM negociaciones n WHERE n.contacto_id=$1 ORDER BY n.creado`, [c.id]);
    for (const x of ns) console.log(`      - ${x.etapa.padEnd(10)} creada ${f(x.creado)} · último mensaje del cliente ${f(x.ultimo_in)}`);
    if (!ns.length) console.log('      (sin negociaciones)');
  }
  if (!cs.length) hallazgos.push('No existe ningún contacto con ese número. Revisá que esté bien escrito.');

  /* Mensajes recibidos en las últimas 48 h */
  const { rows: ib } = await q(
    `SELECT i.remitente, i.nombre, left(i.txt,60) AS txt, i.estado, i.error, i.ts, c.nombre AS canal
       FROM inbox i LEFT JOIN canales c ON c.id=i.canal_id
      WHERE i.ts > now() - interval '48 hours' ORDER BY i.ts DESC LIMIT 25`);
  const deEste = ib.filter(x => norm(x.remitente) === n);
  const lids = ib.filter(x => String(x.remitente).includes('@lid'));
  console.log(`\n▸ Mensajes recibidos en las últimas 48 h: ${ib.length} · de este número: ${deEste.length} · con identificador LID: ${lids.length}`);
  for (const x of ib.slice(0, 15)) {
    console.log(`  ${f(x.ts)} · ${String(x.remitente).padEnd(20)} · ${(x.nombre || '').padEnd(14)} · ${x.estado}${x.error ? ' · ' + x.error : ''}\n      «${x.txt || ''}»`);
  }
  if (!ib.length) hallazgos.push('No entró ningún mensaje en 48 h: la línea de WhatsApp puede estar desconectada (Administración → Canales).');
  if (ib.some(x => x.estado === 'cuarentena')) hallazgos.push('Hay mensajes en cuarentena: miralos en Administración → Salud de mensajería.');
  if (ib.some(x => x.estado === 'pendiente' && Date.now() - new Date(x.ts) > 60000)) hallazgos.push('Hay mensajes sin procesar hace más de un minuto: revisá «pm2 logs iciia-crm».');
  if (lids.length && !deEste.length) hallazgos.push('WhatsApp está mandando mensajes con identificador LID en vez del teléfono. Si tu cliente escribió recién, probablemente es uno de esos.');

  /* Contactos creados por LID */
  const { rows: dup } = await q(
    `SELECT c.id, c.nombre, c.externos, c.creado,
            (SELECT left(m.txt,50) FROM mensajes m JOIN negociaciones x ON x.id=m.negociacion_id
              WHERE x.contacto_id=c.id AND m.dir='in' ORDER BY m.ts DESC LIMIT 1) AS ultimo
       FROM contactos c
      WHERE c.externos::text LIKE '%@lid%' AND COALESCE(c.tel_norm,'')='' ORDER BY c.creado DESC LIMIT 10`);
  if (dup.length) {
    console.log(`\n▸ Contactos sin teléfono creados por identificador LID: ${dup.length}`);
    for (const d of dup) console.log(`  · ${d.nombre} · creado ${f(d.creado)} · último mensaje «${d.ultimo || ''}»\n    id ${d.id}`);
    hallazgos.push(`Si alguno de esos contactos «WhatsApp …» es tu cliente, unilo con:\n     node --env-file=.env diag.mjs ${telArg} --unir <id>`);
  }

  console.log('\n══ Conclusión ══');
  (hallazgos.length ? hallazgos : ['No se ve ningún problema en los datos. Pegá esta salida para revisarla.'])
    .forEach(h => console.log('  → ' + h));
  console.log('');
  }
} catch (e) { console.error('✖ ' + e.message); process.exitCode = 1; }
finally { await db.end(); }

/* ---------- Unir un contacto duplicado con el real ---------- */
async function unir() {
  if (!idDup) throw new Error('Falta el id del contacto a unir.');
  const c = await db.connect();
  try {
    await c.query('BEGIN');
    const { rows: [dupl] } = await c.query('SELECT * FROM contactos WHERE id=$1', [idDup]);
    if (!dupl) throw new Error('No existe un contacto con ese id.');
    const { rows: [real] } = await c.query(
      'SELECT * FROM contactos WHERE empresa_id=$1 AND tel_norm=$2 AND id<>$3 ORDER BY creado LIMIT 1', [dupl.empresa_id, n, dupl.id]);
    if (!real) throw new Error(`No hay otro contacto con el número ${telArg} en la misma empresa.`);
    const ABIERTAS = ['nuevo', 'contactado', 'espera'];
    const { rows: abR } = await c.query('SELECT id FROM negociaciones WHERE contacto_id=$1 AND etapa=ANY($2)', [real.id, ABIERTAS]);
    const { rows: abD } = await c.query('SELECT id FROM negociaciones WHERE contacto_id=$1 AND etapa=ANY($2)', [dupl.id, ABIERTAS]);
    if (abR[0] && abD[0]) {
      // Las dos tienen negociación abierta: la conversación del duplicado pasa a la del cliente real
      for (const t of ['mensajes', 'historial', 'transferencias', 'ubicaciones', 'outbox'])
        await c.query(`UPDATE ${t} SET negociacion_id=$2 WHERE negociacion_id=$1`, [abD[0].id, abR[0].id]);
      await c.query('DELETE FROM negociaciones WHERE id=$1', [abD[0].id]);
      await c.query(`UPDATE negociaciones SET etapa='espera', entrada_etapa=now(), actualizado=now(), aviso_sla=FALSE
                      WHERE id=$1 AND etapa<>'espera'`, [abR[0].id]);
    }
    const { rows: [prev] } = await c.query('SELECT COUNT(*)::int AS n FROM negociaciones WHERE contacto_id=$1', [real.id]);
    await c.query('UPDATE negociaciones SET contacto_id=$2 WHERE contacto_id=$1', [dupl.id, real.id]);
    if (!abR[0] && abD[0] && prev.n > 0) {
      // El cliente ya tenía negociaciones cerradas: la nueva va a «Cliente espera respuesta»
      await c.query(`UPDATE negociaciones SET etapa='espera', titulo='Cliente vuelve a comunicarse',
                       entrada_etapa=now(), actualizado=now() WHERE id=$1 AND etapa='nuevo'`, [abD[0].id]);
    }
    await c.query('UPDATE ubicaciones SET contacto_id=$2 WHERE contacto_id=$1', [dupl.id, real.id]);
    const lid = Object.values(dupl.externos || {}).find(v => String(v).includes('@lid'));
    await c.query(`UPDATE contactos SET externos = externos || $2::jsonb WHERE id=$1`,
      [real.id, JSON.stringify(lid ? { lid, wa_jid: lid } : {})]);
    await c.query('DELETE FROM contactos WHERE id=$1', [dupl.id]);
    await c.query(`INSERT INTO auditoria (empresa_id,usuario,accion,detalle) VALUES ($1,'Sistema','Unión de contactos',$2)`,
      [dupl.empresa_id, `${dupl.nombre} → ${real.nombre}`]);
    await c.query('COMMIT');
    console.log(`\n✔ «${dupl.nombre}» quedó unido a «${real.nombre}».`);
    console.log('  Los próximos mensajes con ese identificador van directo a este cliente. Recargá el tablero.\n');
  } catch (e) { await c.query('ROLLBACK'); throw e; }
  finally { c.release(); }
}
