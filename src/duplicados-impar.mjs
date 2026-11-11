/** IMPAR · un cliente = una ficha; una ficha = una sola negociación abierta.
 *
 * El duplicado típico de WhatsApp: el primer mensaje llega por el identificador
 * privado (@lid) sin número, se crea una ficha sin teléfono; después WhatsApp
 * informa el número real y el siguiente mensaje (o una alta manual) crea otra
 * ficha con el teléfono. Cuando WhatsApp confirma que ese @lid y ese número son
 * la misma persona, las dos fichas se unifican en la que tiene el teléfono.
 *
 * Nunca se unifican fichas por parecido de nombre ni por números escritos a mano:
 * solo por la equivalencia número/@lid que informa la propia sesión de WhatsApp.
 * Los registros no se pierden: mensajes, historial, notas, ubicaciones y
 * negociaciones cerradas pasan a la ficha que queda.
 */
import { q, tx, telNorm } from './db.mjs';
import { emitir } from './realtime.mjs';

export const ETAPAS_ABIERTAS = ['nuevo', 'contactado', 'espera'];
const GENERICO = /^(WhatsApp|Messenger|Instagram|Contacto) /;
const lidValido = v => /^[0-9]{6,22}@lid$/.test(String(v || ''));
const digitosPN = v => { const d = String(v || '').split('@')[0].replace(/\D/g, ''); return /^[0-9]{10,15}$/.test(d) ? d : null; };

/** Une dos negociaciones abiertas del mismo cliente en la más antigua. */
async function unirNegociacionesAbiertas(db, empresaId, contactoId, por) {
  const { rows } = await db.query(
    `SELECT id,valor,agente_id,etapa FROM negociaciones
      WHERE empresa_id=$1 AND contacto_id=$2 AND etapa = ANY($3) ORDER BY creado, id FOR UPDATE`,
    [empresaId, contactoId, ETAPAS_ABIERTAS]);
  if (rows.length < 2) return rows[0]?.id || null;
  const [principal, ...resto] = rows;
  for (const d of resto) await absorberNegociacion(db, empresaId, principal, d, por);
  return principal.id;
}

async function absorberNegociacion(db, empresaId, principal, dup, por) {
  for (const tabla of ['mensajes', 'historial', 'notas_internas', 'transferencias', 'outbox', 'ubicaciones'])
    await db.query(`UPDATE ${tabla} SET negociacion_id=$2 WHERE negociacion_id=$1`, [dup.id, principal.id]);
  await db.query('UPDATE notificaciones SET ref=$2 WHERE ref=$1', [dup.id, principal.id]);
  // Si la que queda no tenía monto ni agente, conserva los de la duplicada.
  await db.query(
    `UPDATE negociaciones p SET
        valor = CASE WHEN COALESCE(p.valor,0)=0 THEN COALESCE(d.valor,p.valor) ELSE p.valor END,
        agente_id = COALESCE(p.agente_id,d.agente_id),
        etapa = CASE WHEN d.etapa='espera' THEN 'espera' ELSE p.etapa END,
        actualizado = GREATEST(p.actualizado,d.actualizado)
       FROM negociaciones d WHERE p.id=$1 AND d.id=$2`, [principal.id, dup.id]);
  await db.query('DELETE FROM negociaciones WHERE id=$1 AND empresa_id=$2', [dup.id, empresaId]);
  await db.query('INSERT INTO historial (empresa_id,negociacion_id,txt,por) VALUES ($1,$2,$3,$4)',
    [empresaId, principal.id, '🔗 Se unificó una negociación duplicada del mismo cliente: sus mensajes e historial quedan aquí', por]);
}

/** Pasa todo lo de la ficha duplicada a la principal y borra la duplicada.
 * Debe ejecutarse dentro de una transacción. Devuelve el id de la negociación abierta resultante. */
export async function fusionarContactos(db, empresaId, principalId, duplicadoId, { motivo = 'mismo número de WhatsApp', por = 'Sistema', lid = null } = {}) {
  if (!principalId || !duplicadoId || principalId === duplicadoId) return null;
  const { rows: cs } = await db.query(
    'SELECT * FROM contactos WHERE empresa_id=$1 AND id = ANY($2) FOR UPDATE', [empresaId, [principalId, duplicadoId]]);
  const p = cs.find(c => c.id === principalId), d = cs.find(c => c.id === duplicadoId);
  if (!p || !d) return null;

  // 1) Negociaciones: todas a la ficha principal; si quedan dos abiertas, se unen.
  const { rows: abiertasDup } = await db.query(
    'SELECT id FROM negociaciones WHERE empresa_id=$1 AND contacto_id=$2 AND etapa = ANY($3)', [empresaId, d.id, ETAPAS_ABIERTAS]);
  const { rows: abiertasP } = await db.query(
    'SELECT id FROM negociaciones WHERE empresa_id=$1 AND contacto_id=$2 AND etapa = ANY($3) ORDER BY creado LIMIT 1', [empresaId, p.id, ETAPAS_ABIERTAS]);
  if (abiertasDup.length && abiertasP.length) {
    // Se cierra momentáneamente para no chocar con el bloqueo de «una abierta por cliente».
    const { rows: [pr] } = await db.query('SELECT id,valor,agente_id,etapa FROM negociaciones WHERE id=$1', [abiertasP[0].id]);
    for (const n of abiertasDup) {
      const { rows: [dn] } = await db.query('SELECT id,valor,agente_id,etapa FROM negociaciones WHERE id=$1', [n.id]);
      await absorberNegociacion(db, empresaId, pr, dn, por);
    }
  }
  await db.query('UPDATE negociaciones SET contacto_id=$2 WHERE empresa_id=$3 AND contacto_id=$1', [d.id, p.id, empresaId]);

  // 2) Registros ligados a la ficha.
  for (const tabla of ['ubicaciones', 'solicitudes', 'campana_destinos', 'impar_clientes_fuente'])
    await db.query(`UPDATE ${tabla} SET contacto_id=$2 WHERE contacto_id=$1`, [d.id, p.id]);
  // Los teléfonos de la duplicada se guardan y se vuelven a cargar en la principal
  // cuando la duplicada ya no exista (el bloqueo impide un número en dos fichas).
  const { rows: telsDup } = await db.query(
    'DELETE FROM contacto_telefonos WHERE contacto_id=$1 RETURNING numero,tel_norm,etiqueta', [d.id]);
  // Fichas antiguas sin su número principal en la tabla de teléfonos: tampoco se pierde.
  const claveDup = String(d.tel || '').replace(/\D/g, '').slice(-8);
  if (claveDup.length === 8 && !telsDup.some(t => t.tel_norm === claveDup))
    telsDup.push({ numero: d.tel, tel_norm: claveDup, etiqueta: 'Principal' });

  // 3) Datos de la ficha: se completan los vacíos, nunca se pisa lo cargado.
  const externos = { ...(d.externos || {}), ...(p.externos || {}) };
  const lidDup = lid || [d.externos?.whatsapp].find(lidValido);
  if (lidDup) externos.whatsapp_lid = lidDup;
  const nombre = GENERICO.test(p.nombre || '') && d.nombre && !GENERICO.test(d.nombre) ? d.nombre : p.nombre;
  const vacio = v => !String(v ?? '').trim();
  // Primero se borra la duplicada: así su teléfono (si lo tenía) queda libre para la principal.
  await db.query('DELETE FROM contactos WHERE id=$1 AND empresa_id=$2', [d.id, empresaId]);
  await db.query(
    `UPDATE contactos SET nombre=$3, externos=$4,
        tel = CASE WHEN tel_norm='' THEN $5 ELSE tel END,
        email = CASE WHEN email='' THEN $6 ELSE email END,
        doc = CASE WHEN doc='' THEN $7 ELSE doc END,
        ciudad = CASE WHEN ciudad='' THEN $8 ELSE ciudad END,
        direccion = CASE WHEN direccion='' THEN $9 ELSE direccion END,
        responsable_id = COALESCE(responsable_id,$10),
        frecuente = frecuente OR $11,
        notas = CASE WHEN $12='' THEN notas WHEN notas='' THEN $12 ELSE notas || E'\\n' || $12 END
      WHERE id=$1 AND empresa_id=$2`,
    [p.id, empresaId, nombre, JSON.stringify(externos), d.tel || '', d.email || '', d.doc || '', d.ciudad || '',
     d.direccion || '', d.responsable_id || null, !!d.frecuente, vacio(d.notas) || d.notas === p.notas ? '' : d.notas]);
  const { rows: [quedo] } = await db.query('SELECT tel_norm FROM contactos WHERE id=$1', [p.id]);
  for (const t of telsDup) {
    if (!t.tel_norm) continue;
    const etiqueta = t.tel_norm === quedo?.tel_norm ? 'Principal' : (t.etiqueta === 'Principal' ? 'Otro número' : t.etiqueta);
    await db.query(`INSERT INTO contacto_telefonos (empresa_id,contacto_id,numero,tel_norm,etiqueta)
                    VALUES ($1,$2,$3,$4,$5) ON CONFLICT (empresa_id,tel_norm) DO NOTHING`, [empresaId, p.id, t.numero, t.tel_norm, etiqueta]);
  }

  const negId = await unirNegociacionesAbiertas(db, empresaId, p.id, por)
    || (await db.query('SELECT id FROM negociaciones WHERE empresa_id=$1 AND contacto_id=$2 ORDER BY actualizado DESC LIMIT 1', [empresaId, p.id])).rows[0]?.id;
  if (negId) await db.query('INSERT INTO historial (empresa_id,negociacion_id,txt,por) VALUES ($1,$2,$3,$4)',
    [empresaId, negId, `🔗 Ficha duplicada «${d.nombre || 'sin nombre'}» unificada en este cliente (${motivo})`, por]);
  return { contactoId: p.id, negociacionId: negId, eliminado: d.id };
}

/** WhatsApp confirmó que este número y este @lid son la misma persona: una sola ficha. */
export async function unificarPorPareja(empresaId, pnJid, lidJid) {
  const numero = digitosPN(pnJid), lid = String(lidJid || '').toLowerCase();
  if (!empresaId || !numero || !lidValido(lid)) return null;
  const clave = telNorm(numero), lidDigitos = lid.split('@')[0];
  const r = await tx(async db => {
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [empresaId + ':' + clave]);
    // Fichas abiertas por el @lid (con sufijo, sin sufijo en fichas antiguas, o ya anotado aparte).
    const { rows: porLid } = await db.query(
      `SELECT * FROM contactos WHERE empresa_id=$1
          AND (externos->>'whatsapp' IN ($2,$3) OR externos->>'whatsapp_lid'=$2) ORDER BY creado`,
      [empresaId, lid, lidDigitos]);
    const { rows: porTel } = await db.query(
      `SELECT DISTINCT c.* FROM contactos c
         LEFT JOIN contacto_telefonos t ON t.contacto_id=c.id AND t.empresa_id=c.empresa_id
        WHERE c.empresa_id=$1 AND (c.tel_norm=$2 OR t.tel_norm=$2) ORDER BY c.creado`, [empresaId, clave]);
    // Una ficha antigua pudo guardar los dígitos del @lid como teléfono: no es un número real.
    const sinNumero = c => !c.tel_norm || c.tel_norm === telNorm(lidDigitos);
    const lidSolos = porLid.filter(c => sinNumero(c) && !porTel.some(t => t.id === c.id));
    if (!lidSolos.length) return null;
    const principal = porTel[0];
    if (!principal) {
      // No hay ficha con ese número: la ficha del @lid recibe el número real.
      const [unica, ...otras] = lidSolos;
      await db.query(`UPDATE contactos SET tel=$3, tel_norm=$4,
                        externos = externos || jsonb_build_object('whatsapp_lid',$5::text)
                      WHERE id=$1 AND empresa_id=$2`, [unica.id, empresaId, numero, clave, lid]);
      await db.query(`INSERT INTO contacto_telefonos (empresa_id,contacto_id,numero,tel_norm,etiqueta)
                      VALUES ($1,$2,$3,$4,'Principal') ON CONFLICT (empresa_id,tel_norm) DO NOTHING`, [empresaId, unica.id, numero, clave]);
      const hechos = [];
      for (const o of otras) hechos.push(await fusionarContactos(db, empresaId, unica.id, o.id, { lid }));
      return { contactoId: unica.id, completado: true, fusiones: hechos.filter(Boolean) };
    }
    const fusiones = [];
    for (const d of lidSolos) fusiones.push(await fusionarContactos(db, empresaId, principal.id, d.id, { lid }));
    return { contactoId: principal.id, fusiones: fusiones.filter(Boolean) };
  });
  if (r?.fusiones?.length) {
    // El tablero se vuelve a cargar: la tarjeta duplicada desaparece y queda la unificada.
    emitir(empresaId, 'neg:recargar', {});
    console.log(`[duplicados] ${r.fusiones.length} ficha(s) unificada(s) por equivalencia de WhatsApp`);
  }
  return r;
}

const claveTel = tel => { const d = String(tel || '').replace(/\D/g, ''); return d.length >= 8 ? d.slice(-8) : ''; };

/** Fichas con el mismo número (principal o secundario, en cualquier formato): se unen en la más antigua. */
export async function unificarPorNumero() {
  const { rows } = await q(
    `SELECT c.empresa_id, c.id, c.tel, c.tel_norm, c.creado, t.tel_norm AS secundario
       FROM contactos c LEFT JOIN contacto_telefonos t ON t.contacto_id=c.id
      ORDER BY c.creado, c.id`);
  const fichas = new Map(), dueño = new Map(), padre = new Map();
  const raiz = x => { while (padre.get(x) !== x) { padre.set(x, padre.get(padre.get(x))); x = padre.get(x); } return x; };
  for (const r of rows) {
    if (!fichas.has(r.id)) { fichas.set(r.id, r); padre.set(r.id, r.id); }
    for (const k of new Set([claveTel(r.tel), r.secundario && r.secundario.length === 8 ? r.secundario : ''])) {
      if (!k) continue;
      const llave = r.empresa_id + ':' + k;
      if (!dueño.has(llave)) dueño.set(llave, r.id);
      else { const a = raiz(dueño.get(llave)), b = raiz(r.id); if (a !== b) padre.set(b, a); }
    }
  }
  const grupos = new Map();
  for (const id of fichas.keys()) { const g = raiz(id); if (!grupos.has(g)) grupos.set(g, []); grupos.get(g).push(fichas.get(id)); }
  let fusiones = 0, normalizados = 0;
  for (const lista of grupos.values()) {
    lista.sort((a, b) => new Date(a.creado) - new Date(b.creado));
    const [principal, ...resto] = lista;
    if (resto.length) {
      await tx(async db => {
        await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [principal.empresa_id + ':' + (claveTel(principal.tel) || principal.id)]);
        for (const d of resto) if (await fusionarContactos(db, principal.empresa_id, principal.id, d.id, { motivo: 'mismo número de teléfono' })) fusiones++;
      }).catch(e => console.warn('[duplicados] No se pudo unir un grupo de fichas:', e.code || e.name));
    }
    // Número guardado con el formato viejo (otro largo de clave): se lleva al formato actual.
    const k = claveTel(principal.tel);
    if (k && principal.tel_norm !== k) {
      await q('UPDATE contactos SET tel_norm=$2 WHERE id=$1', [principal.id, k])
        .then(() => normalizados++).catch(e => console.warn('[duplicados] Clave de teléfono sin normalizar:', e.code || e.name));
    }
  }
  if (fusiones || normalizados) console.log(`[duplicados] Por número: ${fusiones} ficha(s) unificada(s), ${normalizados} teléfono(s) normalizado(s)`);
  return fusiones + normalizados;
}

/** Barrido al iniciar: unifica lo que haya quedado duplicado antes de esta versión. */
export async function unificarDuplicadosExistentes() {
  let total = 0;
  try {
    total += await unificarPorNumero();
    const { rows } = await q(
      `SELECT DISTINCT w.empresa_id, w.pn_jid, w.lid_jid FROM wa_identidades_impar w
        WHERE EXISTS (SELECT 1 FROM contactos c WHERE c.empresa_id=w.empresa_id
                       AND (c.externos->>'whatsapp' IN (w.lid_jid, split_part(w.lid_jid,'@',1))))`);
    // Un @lid con dos números distintos es ambiguo: no se toca.
    const porLid = new Map();
    for (const f of rows) {
      const k = f.empresa_id + '|' + f.lid_jid, n = digitosPN(f.pn_jid);
      if (!porLid.has(k)) porLid.set(k, { ...f, numeros: new Set() });
      if (n) porLid.get(k).numeros.add(telNorm(n));
    }
    for (const f of porLid.values()) {
      if (f.numeros.size !== 1) continue;
      const r = await unificarPorPareja(f.empresa_id, f.pn_jid, f.lid_jid)
        .catch(e => { console.warn('[duplicados] No se pudo unificar una ficha:', e.code || e.name); return null; });
      total += r?.fusiones?.length || (r?.completado ? 1 : 0);
    }
    // Dos negociaciones abiertas en la misma ficha (no debería existir; se repara si aparece).
    const { rows: dobles } = await q(
      `SELECT empresa_id, contacto_id FROM negociaciones WHERE etapa = ANY($1)
        GROUP BY empresa_id, contacto_id HAVING count(*) > 1`, [ETAPAS_ABIERTAS]);
    for (const d of dobles) { await tx(db => unirNegociacionesAbiertas(db, d.empresa_id, d.contacto_id, 'Sistema')); total++; }
    // Con los repetidos ya unidos, la base pasa a bloquear identidades repetidas de redes y @lid.
    for (const k of ['messenger', 'instagram', 'whatsapp_lid']) {
      const { rows: rep } = await q(`SELECT 1 FROM contactos WHERE externos ? $1 GROUP BY empresa_id, externos->>$1 HAVING count(*)>1 LIMIT 1`, [k]);
      if (!rep.length) await q(`CREATE UNIQUE INDEX IF NOT EXISTS idx_contacto_externo_${k} ON contactos (empresa_id, (externos->>'${k}')) WHERE externos ? '${k}'`);
    }
  } catch (e) { console.warn('[duplicados] Barrido inicial:', e.code || e.name); }
  if (total) console.log(`[duplicados] Barrido inicial: ${total} corrección(es)`);
  return total;
}

/** Traduce el bloqueo de la base de datos a un mensaje claro. */
export function errorDuplicado(e) {
  if (e?.code !== '23505' && e?.code !== 'P0001') return null;
  const c = String(e.constraint || '') + ' ' + String(e.message || '');
  if (/idx_neg_activa_unica/.test(c))
    return Object.assign(new Error('Este cliente ya tiene una negociación abierta. Abrí esa negociación; no se creó otra.'), { status: 409, codigo: 'negociacion_duplicada' });
  if (/idx_contacto_tel_unico|uq_impar_telefono_secundario|telefono_duplicado|idx_contacto_externo/.test(c))
    return Object.assign(new Error('Este número ya pertenece a otro cliente de IMPAR. Abrí la ficha existente; no se creó otra.'), { status: 409, codigo: 'contacto_duplicado' });
  return null;
}

/* ================= Revisión manual (solo administración) ================= */
const sinAcentos = t => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const nombreClave = t => {
  const n = sinAcentos(t).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return n.length >= 6 && !GENERICO.test(String(t || '')) && /[a-z]/.test(n) ? n : '';
};

/** Grupos de fichas que podrían ser el mismo cliente: mismo teléfono (en cualquier formato,
 * principal o secundario), mismo documento o código SAP, o mismo nombre. */
export async function buscarPosiblesDuplicados(empresaId, limite = 200) {
  const { rows } = await q(
    `SELECT c.id, c.nombre, c.tel, c.doc, c.externos->>'sap' AS sap, c.creado, c.responsable_id,
            u.nombre AS responsable, c.sucursal,
            (SELECT string_agg(t.tel_norm, ',') FROM contacto_telefonos t WHERE t.contacto_id=c.id) AS otros,
            (SELECT count(*)::int FROM negociaciones n WHERE n.contacto_id=c.id) AS negociaciones,
            (SELECT n.etapa FROM negociaciones n WHERE n.contacto_id=c.id AND n.etapa = ANY($2) LIMIT 1) AS abierta
       FROM contactos c LEFT JOIN usuarios u ON u.id=c.responsable_id
      WHERE c.empresa_id=$1 ORDER BY c.creado, c.id`, [empresaId, ETAPAS_ABIERTAS]);
  const padre = new Map(), duenos = new Map(), motivos = new Map();
  const raiz = x => { while (padre.get(x) !== x) { padre.set(x, padre.get(padre.get(x))); x = padre.get(x); } return x; };
  const unir = (llave, id, motivo) => {
    if (!duenos.has(llave)) { duenos.set(llave, id); return; }
    const a = raiz(duenos.get(llave)), b = raiz(id);
    if (a !== b) padre.set(b, a);
    motivos.set(llave, motivo);
  };
  for (const c of rows) {
    padre.set(c.id, c.id);
    const tels = new Set([claveTel(c.tel), ...String(c.otros || '').split(',').filter(x => x.length === 8)]);
    for (const t of tels) if (t) unir('tel:' + t, c.id, 'Mismo teléfono');
    const doc = String(c.doc || '').replace(/[^0-9a-z]/gi, '').toLowerCase();
    if (doc.length >= 5) unir('doc:' + doc, c.id, 'Mismo documento');
    if (c.sap) unir('sap:' + String(c.sap).trim().toLowerCase(), c.id, 'Mismo código SAP');
    const n = nombreClave(c.nombre);
    if (n) unir('nom:' + n, c.id, 'Mismo nombre');
  }
  const grupos = new Map();
  for (const c of rows) { const g = raiz(c.id); if (!grupos.has(g)) grupos.set(g, []); grupos.get(g).push(c); }
  // Motivos de cada grupo: las llaves repetidas cuyo primer dueño quedó en ese grupo.
  const motivosGrupo = new Map();
  for (const [llave, motivo] of motivos) {
    const g = raiz(duenos.get(llave));
    if (!motivosGrupo.has(g)) motivosGrupo.set(g, new Set());
    motivosGrupo.get(g).add(motivo);
  }
  const peso = m => m.has('Mismo teléfono') ? 0 : m.has('Mismo documento') || m.has('Mismo código SAP') ? 1 : 2;
  return [...grupos.entries()].filter(([, l]) => l.length > 1)
    .map(([g, lista]) => ({
      id: g,
      motivos: [...(motivosGrupo.get(g) || [])],
      contactos: lista.map(c => ({ id: c.id, nombre: c.nombre, tel: c.tel, doc: c.doc, creado: c.creado,
        responsableId: c.responsable_id, responsable: c.responsable, sucursal: c.sucursal,
        negociaciones: c.negociaciones, abierta: c.abierta }))
    }))
    .sort((a, b) => peso(new Set(a.motivos)) - peso(new Set(b.motivos)) || b.contactos.length - a.contactos.length)
    .slice(0, limite);
}

/** El administrador unifica varias fichas en una y elige el único responsable. */
export async function unificarManual(empresaId, { principalId, otrosIds, responsableId }, usuario) {
  const fallo = (status, message) => { throw Object.assign(new Error(message), { status }); };
  const uuid = v => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v || ''));
  const otros = [...new Set((Array.isArray(otrosIds) ? otrosIds : []).filter(x => x !== principalId))];
  if (!uuid(principalId) || !otros.length || !otros.every(uuid)) fallo(422, 'Elegí la ficha que queda y al menos otra para unir.');
  if (otros.length > 50) fallo(422, 'Se pueden unir hasta 50 fichas por vez.');
  if (!uuid(responsableId)) fallo(422, 'Elegí el responsable del cliente.');
  const r = await tx(async db => {
    const { rows: [resp] } = await db.query(
      'SELECT id,nombre FROM usuarios WHERE id=$1 AND empresa_id=$2 AND activo AND NOT oculto', [responsableId, empresaId]);
    if (!resp) fallo(422, 'El responsable elegido no está activo.');
    const { rows: cs } = await db.query('SELECT id,nombre FROM contactos WHERE empresa_id=$1 AND id = ANY($2) FOR UPDATE',
      [empresaId, [principalId, ...otros]]);
    if (cs.length !== otros.length + 1) fallo(404, 'Alguna de las fichas ya no existe. Volvé a verificar los duplicados.');
    let negId = null;
    for (const id of otros) {
      const f = await fusionarContactos(db, empresaId, principalId, id, { motivo: 'unificado por administración', por: usuario.nombre });
      negId = f?.negociacionId || negId;
    }
    // Un solo responsable: la ficha y su negociación abierta quedan a cargo de la misma persona.
    await db.query('UPDATE contactos SET responsable_id=$3 WHERE id=$1 AND empresa_id=$2', [principalId, empresaId, resp.id]);
    const { rows: movidas } = await db.query(
      `UPDATE negociaciones SET agente_id=$3, actualizado=now() WHERE empresa_id=$1 AND contacto_id=$2
          AND etapa = ANY($4) AND agente_id IS DISTINCT FROM $3 RETURNING id`, [empresaId, principalId, resp.id, ETAPAS_ABIERTAS]);
    const abierta = (await db.query('SELECT id FROM negociaciones WHERE empresa_id=$1 AND contacto_id=$2 AND etapa = ANY($3) LIMIT 1',
      [empresaId, principalId, ETAPAS_ABIERTAS])).rows[0]?.id;
    if (abierta && movidas.length) await db.query('INSERT INTO historial (empresa_id,negociacion_id,txt,por) VALUES ($1,$2,$3,$4)',
      [empresaId, abierta, `Responsable único tras unificar fichas: ${resp.nombre}`, usuario.nombre]);
    return { contactoId: principalId, unidas: otros.length, responsable: resp.nombre, negociacionId: abierta || negId,
      nombres: cs.filter(c => c.id !== principalId).map(c => c.nombre) };
  });
  emitir(empresaId, 'neg:recargar', {});
  return r;
}
