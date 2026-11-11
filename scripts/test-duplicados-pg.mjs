/** Un número = una ficha; una ficha = una negociación abierta. PostgreSQL real, base temporal
 * creada y borrada por la prueba, con datos ficticios. Nunca usa producción. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

if (!process.env.TEST_DATABASE_URL) throw new Error('Requiere TEST_DATABASE_URL de pruebas. Nunca usar producción.');
const nombreBase = 'impar_dup_' + randomUUID().replaceAll('-', '').slice(0, 16);
const control = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
await control.connect();
await control.query('CREATE DATABASE ' + nombreBase);
const url = new URL(process.env.TEST_DATABASE_URL); url.pathname = '/' + nombreBase;
process.env.DATABASE_URL = url.toString();
process.env.ADMIN_PASS ||= 'Prueba.Impar.2026';

const db = await import('../src/db.mjs');
let fallo = null;
try {
  await db.migrar();
  await db.seed();
  const { q, tx } = db;
  const core = await import('../src/core.mjs');
  const dup = await import('../src/duplicados-impar.mjs');
  const [emp] = (await q("SELECT * FROM empresas WHERE codigo='impar'")).rows;
  const E = emp.id;
  const contacto = async (nombre, tel, externos = {}) => (await q(
    "INSERT INTO contactos (empresa_id,nombre,tel,externos,sucursal) VALUES ($1,$2,$3,$4,'Central') RETURNING *",
    [E, nombre, tel, JSON.stringify(externos)])).rows[0];
  const negociacion = async (c, etapa = 'nuevo') => (await q(
    "INSERT INTO negociaciones (empresa_id,contacto_id,titulo,etapa,origen) VALUES ($1,$2,'Prueba',$3,'whatsapp') RETURNING *",
    [E, c.id, etapa])).rows[0];
  const mensaje = (n, txt) => q("INSERT INTO mensajes (empresa_id,negociacion_id,dir,txt) VALUES ($1,$2,'in',$3)", [E, n.id, txt]);
  const cuenta = async (sql, p) => Number((await q(sql, p)).rows[0].n);

  /* 1) La base calcula la clave del teléfono y rechaza el mismo número en otro formato. */
  const a = await contacto('Cliente A', '+595 981 100 001');
  assert.equal(a.tel_norm, '81100001', 'La clave del teléfono la calcula la base');
  await assert.rejects(() => contacto('Cliente A bis', '0981100001'), e => e.code === '23505', 'Mismo número con otro formato: bloqueado');

  /* 2) Un número no puede ser principal de una ficha y secundario de otra (en ningún orden). */
  const b = await contacto('Cliente B', '595981100002');
  await assert.rejects(() => q("INSERT INTO contacto_telefonos (empresa_id,contacto_id,numero,tel_norm) VALUES ($1,$2,'595981100001','81100001')", [E, b.id]),
    e => e.code === '23505', 'Secundario igual al principal de otro cliente: bloqueado');
  await q("INSERT INTO contacto_telefonos (empresa_id,contacto_id,numero,tel_norm) VALUES ($1,$2,'595981100003','81100003')", [E, b.id]);
  await assert.rejects(() => contacto('Cliente C', '595981100003'), e => e.code === '23505', 'Principal igual al secundario de otro cliente: bloqueado');
  assert.equal(dup.errorDuplicado(await contacto('X', '595981100003').catch(e => e))?.status, 409, 'El bloqueo se traduce a un aviso 409');

  /* 3) Alta por pantalla con el número secundario de otro cliente: devuelve la ficha existente. */
  const r = await core.crearContacto(emp, { nombre: 'Otro nombre', tel: '595981100003' }, { devolverCreacion: true });
  assert.equal(r.creado, false); assert.equal(r.contacto.id, b.id);

  /* 4) Una ficha = una negociación abierta (cualquier etapa abierta). */
  await negociacion(a, 'contactado');
  await assert.rejects(() => negociacion(a, 'espera'), e => e.code === '23505' && dup.errorDuplicado(e)?.codigo === 'negociacion_duplicada');
  await negociacion(a, 'cerrado');

  /* 5) El caso real: ficha por @lid (sin número) y ficha por número, cada una con su negociación abierta.
        Cuando WhatsApp confirma que son la misma persona, queda una sola ficha y una sola negociación. */
  const LID = '123456789012345@lid';
  const porLid = await contacto('WhatsApp 2345', '', { whatsapp: LID });
  const porTel = await contacto('Comercial Ficticia', '595981200001', { whatsapp: '595981200001' });
  const nLid = await negociacion(porLid, 'espera'); await mensaje(nLid, 'hola por lid');
  const nTel = await negociacion(porTel, 'contactado'); await mensaje(nTel, 'hola por numero');
  await q("INSERT INTO historial (empresa_id,negociacion_id,txt,por) VALUES ($1,$2,'nota previa','Agente')", [E, nLid.id]);
  const u = await dup.unificarPorPareja(E, '595981200001@s.whatsapp.net', LID);
  assert.equal(u.contactoId, porTel.id, 'Queda la ficha que tiene el número');
  assert.equal(await cuenta('SELECT count(*) n FROM contactos WHERE id=$1', [porLid.id]), 0, 'La ficha del @lid se unificó');
  const abiertas = (await q("SELECT * FROM negociaciones WHERE contacto_id=$1 AND etapa IN ('nuevo','contactado','espera')", [porTel.id])).rows;
  assert.equal(abiertas.length, 1, 'Una sola negociación abierta');
  assert.equal(abiertas[0].etapa, 'espera', 'Si el cliente esperaba respuesta, sigue esperando');
  assert.equal(await cuenta('SELECT count(*) n FROM mensajes WHERE negociacion_id=$1', [abiertas[0].id]), 2, 'Los mensajes de las dos quedaron juntos');
  assert.equal(await cuenta("SELECT count(*) n FROM historial WHERE negociacion_id=$1 AND txt='nota previa'", [abiertas[0].id]), 1, 'El historial no se pierde');
  const [quedo] = (await q('SELECT * FROM contactos WHERE id=$1', [porTel.id])).rows;
  assert.equal(quedo.externos.whatsapp_lid, LID, 'El @lid queda anotado en la ficha');
  const encontrada = await core.buscarContacto(emp, { externoTipo: 'whatsapp', externoId: LID });
  assert.equal(encontrada.id, porTel.id, 'Un mensaje futuro por @lid va a la misma ficha');
  assert.equal((await dup.unificarPorPareja(E, '595981200001@s.whatsapp.net', LID)), null, 'Repetir no hace nada');

  /* 6) Ficha por @lid sin ficha con número: recibe el número real (y el alta manual ya no la duplica). */
  const LID2 = '998877665544@lid';
  const solo = await contacto('WhatsApp 5544', '', { whatsapp: LID2 });
  await dup.unificarPorPareja(E, '595981300001@s.whatsapp.net', LID2);
  const [conNumero] = (await q('SELECT * FROM contactos WHERE id=$1', [solo.id])).rows;
  assert.equal(conNumero.tel_norm, '81300001', 'La ficha del @lid quedó con el número');
  const alta = await core.crearContacto(emp, { nombre: 'Alta manual', tel: '595981300001' }, { devolverCreacion: true });
  assert.equal(alta.creado, false); assert.equal(alta.contacto.id, solo.id);

  /* 7) Mensajes simultáneos de un cliente nuevo: una sola ficha y una sola negociación. */
  const entrada = i => core.ingresarMensaje(emp, { origen: 'whatsapp', remitente: '595981400001', nombre: 'Nuevo', texto: 'm' + i, extId: 'dup-' + i });
  const res = await Promise.all([0, 1, 2, 3].map(entrada));
  assert.equal(new Set(res.map(x => x.negociacionId)).size, 1, 'Todos los mensajes en la misma negociación');
  assert.equal(await cuenta("SELECT count(*) n FROM contactos WHERE tel_norm='81400001'"), 1);
  const msj = i => core.ingresarMensaje(emp, { origen: 'messenger', remitente: 'psid-777', nombre: 'Persona Messenger', texto: 'x' + i, extId: 'ms-' + i });
  await Promise.all([0, 1, 2].map(msj));
  assert.equal(await cuenta("SELECT count(*) n FROM contactos WHERE externos->>'messenger'='psid-777'"), 1, 'Messenger: una ficha aunque lleguen juntos');

  /* 8) Revisión del administrador: mismo nombre o documento, unificación con un único responsable. */
  const usr = async (nombre) => (await q("INSERT INTO usuarios (empresa_id,nombre,usuario,pass_hash,rol,sucursal) VALUES ($1,$2,$3,'x','agente','Central') RETURNING *",
    [E, nombre, nombre.toLowerCase().replace(/ /g, '.') + Date.now()])).rows[0];
  const ag1 = await usr('Agente Uno'), ag2 = await usr('Agente Dos');
  const f1 = await contacto('Librería Ficticia Centro', '595981600001');
  const f2 = await contacto('Libreria ficticia  centro', '595981600002');
  await q('UPDATE contactos SET responsable_id=$2 WHERE id=$1', [f1.id, ag1.id]);
  await q('UPDATE contactos SET responsable_id=$2 WHERE id=$1', [f2.id, ag2.id]);
  const nf1 = await negociacion(f1, 'contactado'), nf2 = await negociacion(f2, 'espera');
  await q('UPDATE negociaciones SET agente_id=$2 WHERE id=$1', [nf1.id, ag1.id]);
  await q('UPDATE negociaciones SET agente_id=$2 WHERE id=$1', [nf2.id, ag2.id]);
  const grupos = await dup.buscarPosiblesDuplicados(E);
  const g = grupos.find(x => x.contactos.some(c => c.id === f1.id));
  assert.ok(g && g.contactos.some(c => c.id === f2.id), 'Detecta el mismo nombre aunque cambien acentos y espacios');
  assert.ok(g.motivos.includes('Mismo nombre'));
  await assert.rejects(() => dup.unificarManual(E, { principalId: f1.id, otrosIds: [], responsableId: ag2.id }, { nombre: 'Admin' }), e => e.status === 422);
  const um = await dup.unificarManual(E, { principalId: f1.id, otrosIds: [f2.id], responsableId: ag2.id }, { nombre: 'Admin' });
  assert.equal(um.unidas, 1); assert.equal(um.responsable, 'Agente Dos');
  const [fq] = (await q('SELECT * FROM contactos WHERE id=$1', [f1.id])).rows;
  assert.equal(fq.responsable_id, ag2.id, 'La ficha queda con el responsable elegido');
  const abiertasF = (await q("SELECT * FROM negociaciones WHERE contacto_id=$1 AND etapa IN ('nuevo','contactado','espera')", [f1.id])).rows;
  assert.equal(abiertasF.length, 1); assert.equal(abiertasF[0].agente_id, ag2.id, 'La negociación abierta queda con el mismo responsable');
  assert.equal(await cuenta("SELECT count(*) n FROM contacto_telefonos WHERE contacto_id=$1 AND tel_norm='81600002'", [f1.id]), 1, 'El otro número queda como secundario');
  const llega = await core.ingresarMensaje(emp, { origen: 'whatsapp', remitente: '595981600002', texto: 'hola', extId: 'unif-1' });
  assert.equal(llega.negociacionId, abiertasF[0].id, 'Si escribe por el otro número, entra a la misma negociación');

  /* 9) Ver revisión otra vez: el grupo ya no aparece. */
  assert.ok(!(await dup.buscarPosiblesDuplicados(E)).some(x => x.contactos.some(c => c.id === f1.id)));

  /* 10) Cliente de redes que pasa su número: misma ficha y negociación, sigue por WhatsApp. */
  const redes = await import('../src/redes-a-whatsapp-impar.mjs');
  assert.equal(redes.extraerCelular('mi número es 0981 700-001 gracias'), '595981700001');
  assert.equal(redes.extraerCelular('+595 982 700 002'), '595982700002');
  assert.equal(redes.extraerCelular('pedido 123456 por 150.000 Gs'), null, 'Montos y pedidos no son teléfonos');
  assert.equal(redes.extraerCelular('0981700001 o 0982700002'), null, 'Con dos números distintos no adivina');
  await q("UPDATE canales SET activo=FALSE WHERE empresa_id=$1", [E]);
  const [wa] = (await q(`INSERT INTO canales (empresa_id,tipo,nombre,activo,config) VALUES ($1,'whatsapp_qr','Principal',TRUE,'{"principal_global":true}') RETURNING *`, [E])).rows;
  const [ms] = (await q(`INSERT INTO canales (empresa_id,tipo,nombre,activo,config) VALUES ($1,'messenger','Página prueba',TRUE,'{"page_id":"p1"}') RETURNING *`, [E])).rows;
  const deRedes = (txt, id) => core.ingresarMensaje(emp, { canalId: ms.id, origen: 'messenger', remitente: 'psid-900', nombre: 'Cliente Redes', texto: txt, extId: id });
  const m1 = await deRedes('hola, precio de cartulinas?', 'r-1');
  let [nm] = (await q('SELECT n.*, ca.tipo canal_tipo FROM negociaciones n JOIN canales ca ON ca.id=n.canal_id WHERE n.id=$1', [m1.negociacionId])).rows;
  assert.equal(nm.canal_tipo, 'messenger');
  const m2 = await deRedes('dale, mi whatsapp es 0981 700 001', 'r-2');
  assert.equal(m2.pasoAWhatsApp, true, 'Detecta el número en el chat');
  assert.equal(m2.negociacionId, m1.negociacionId, 'Misma negociación');
  [nm] = (await q('SELECT n.*, ca.tipo canal_tipo FROM negociaciones n JOIN canales ca ON ca.id=n.canal_id WHERE n.id=$1', [m1.negociacionId])).rows;
  assert.equal(nm.canal_id, wa.id, 'Las respuestas salen por WhatsApp');
  assert.equal(nm.telefono_destino, '595981700001');
  const [cr] = (await q('SELECT * FROM contactos WHERE id=$1', [nm.contacto_id])).rows;
  assert.equal(cr.tel_norm, '81700001', 'La ficha de redes guarda el número');
  assert.equal(cr.externos.messenger, 'psid-900', 'Y conserva su dato de Messenger');
  const m3 = await core.ingresarMensaje(emp, { canalId: wa.id, origen: 'whatsapp', remitente: '595981700001', texto: 'acá estoy', extId: 'r-3' });
  assert.equal(m3.negociacionId, m1.negociacionId, 'Cuando escribe por WhatsApp entra a la misma negociación');
  await deRedes('te mando foto por acá', 'r-4');
  [nm] = (await q('SELECT canal_id FROM negociaciones WHERE id=$1', [m1.negociacionId])).rows;
  assert.equal(nm.canal_id, wa.id, 'Si vuelve a escribir por Messenger, sigue respondiéndose por WhatsApp');
  // Número que ya era de otro cliente: queda una sola ficha (la del número) con los datos de Instagram.
  const [ig] = (await q(`INSERT INTO canales (empresa_id,tipo,nombre,activo,config) VALUES ($1,'instagram','IG prueba',TRUE,'{"page_id":"p1","ig_id":"i1"}') RETURNING *`, [E])).rows;
  const viejoCli = await contacto('Cliente de siempre', '595981700099');
  const i1 = await core.ingresarMensaje(emp, { canalId: ig.id, origen: 'instagram', remitente: 'igsid-55', nombre: '@cliente.ig', texto: 'hola', extId: 'i-1' });
  const pw = await redes.pasarAWhatsApp(emp, { negociacionId: i1.negociacionId, numero: '0981700099', por: 'Agente' });
  assert.equal(pw.unificado, true); assert.equal(pw.contactoId, viejoCli.id);
  const [vc] = (await q('SELECT * FROM contactos WHERE id=$1', [viejoCli.id])).rows;
  assert.equal(vc.externos.instagram, 'igsid-55', 'La ficha del número guarda el dato de Instagram');
  assert.equal(await cuenta("SELECT count(*) n FROM contactos WHERE externos->>'instagram'='igsid-55'"), 1);
  const i2 = await core.ingresarMensaje(emp, { canalId: ig.id, origen: 'instagram', remitente: 'igsid-55', texto: 'sigo acá', extId: 'i-2' });
  assert.equal(i2.negociacionId, pw.negociacionId, 'Instagram vuelve a la misma negociación');

  /* 11) Datos de versiones anteriores: misma persona guardada dos veces con el número en otro formato. */
  await q('ALTER TABLE contactos DISABLE TRIGGER trg_impar_contacto_tel');
  await q('DROP INDEX idx_contacto_tel_unico');
  const viejo = (await q("INSERT INTO contactos (empresa_id,nombre,tel,tel_norm,creado) VALUES ($1,'Ficha antigua','0981500001','981500001',now()-interval '1 year') RETURNING *", [E])).rows[0];
  const copia = (await q("INSERT INTO contactos (empresa_id,nombre,tel,tel_norm) VALUES ($1,'Ficha repetida','595981500001','81500001') RETURNING *", [E])).rows[0];
  await q('ALTER TABLE contactos ENABLE TRIGGER trg_impar_contacto_tel');
  await negociacion(viejo, 'nuevo'); await negociacion(copia, 'espera');
  await dup.unificarDuplicadosExistentes();
  await q("CREATE UNIQUE INDEX idx_contacto_tel_unico ON contactos(empresa_id, tel_norm) WHERE tel_norm <> ''");
  assert.equal(await cuenta("SELECT count(*) n FROM contactos WHERE right(regexp_replace(tel,'\\D','','g'),8)='81500001'"), 1, 'Quedó una sola ficha');
  const [antigua] = (await q('SELECT * FROM contactos WHERE id=$1', [viejo.id])).rows;
  assert.equal(antigua.tel_norm, '81500001', 'La clave vieja se normalizó');
  assert.equal(await cuenta("SELECT count(*) n FROM negociaciones WHERE contacto_id=$1 AND etapa IN ('nuevo','contactado','espera')", [viejo.id]), 1);
  assert.equal(await cuenta(`SELECT count(*) n FROM (SELECT contacto_id FROM negociaciones WHERE etapa IN ('nuevo','contactado','espera') GROUP BY contacto_id HAVING count(*)>1) x`), 0);
  const indices = (await q("SELECT indexname FROM pg_indexes WHERE indexname LIKE 'idx_contacto_externo_%'")).rows.map(x => x.indexname).sort();
  assert.deepEqual(indices, ['idx_contacto_externo_instagram', 'idx_contacto_externo_messenger', 'idx_contacto_externo_whatsapp_lid']);
  console.log('✔ Duplicados: número único, negociación abierta única, unificación @lid/número y barrido de datos anteriores');
} catch (e) { fallo = e; }
finally {
  // Al borrar la base temporal se cortan las conexiones abiertas por otros módulos: es lo esperado.
  process.on('uncaughtException', e => { if (e?.code !== '57P01') { console.error(e); process.exit(1); } });
  await db.pool.end().catch(() => {});
  await control.query('DROP DATABASE IF EXISTS ' + nombreBase + ' WITH (FORCE)').catch(() => {});
  await control.end();
}
if (fallo) { console.error(fallo); process.exit(1); }
process.exit(0);
