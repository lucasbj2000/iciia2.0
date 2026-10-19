import { Router } from 'express';
import { q, tx, telNorm } from '../db.mjs';
import { buscarPorTelefono, agregarTelefono, telefonosContacto, puedeEditarContacto, errorTelefono } from '../telefonos-impar.mjs';
import { requiere, alcanceSQL } from '../auth.mjs';
import { notificar, auditar, historial, nombreEtapa, negActivaPorTel, crearContacto } from '../core.mjs';
import { emitir } from '../realtime.mjs';
import * as ubi from '../ubicaciones.mjs';
import { conversacionContacto } from '../conversacion-contacto.mjs';
import {consultarDestinos,cambiarResponsable} from '../responsable-contacto-impar.mjs';

const r = Router();

/* Búsqueda empresarial acotada para iniciar chats de clientes ya registrados.
 * Disponible para todos los agentes de IMPAR; no entrega su ficha 360 ni
 * el historial de otro responsable. Solo nombre, teléfono e identificación.
 */
r.get('/buscar/registrado', requiere(), async(req,res)=>{
  const busca=String(req.query.q||'').trim().slice(0,90);
  if(busca.length<3)return res.status(422).json({error:'Escribí al menos 3 caracteres para buscar un cliente.'});
  const termino=busca.toLowerCase();
  try{
    const {rows}=await q(
      `SELECT c.id,c.nombre,c.tel,c.sucursal,u.nombre AS responsable
         FROM contactos c LEFT JOIN usuarios u ON u.id=c.responsable_id
        WHERE c.empresa_id=$1 AND
          (strpos(lower(c.nombre),$2)>0 OR strpos(c.tel,$2)>0
          OR strpos(lower(c.email),$2)>0)
        ORDER BY c.nombre LIMIT 25`,
      [req.empresaId,termino]);
    res.set('Cache-Control','no-store').json(rows);
  }catch(e){console.error('[impar] Buscar contacto registrado:',e.message);
    res.status(500).json({error:'No se pudo consultar la base de clientes.'});}
});

r.get('/:id/conversacion', requiere(), async (req, res) => {
  try { res.json(await conversacionContacto(req, req.params.id)); }
  catch (e) { if (!e.status) console.error('[conversación contacto]', e.message); res.status(e.status || 500).json({ error: e.status ? e.message : 'No se pudo consultar la conversación.' }); }
});
r.post('/:id/conversacion', requiere(), async (req, res) => {
  try {
    const resultado = await conversacionContacto(req, req.params.id, req.body || {});
    if (resultado.creada) {
      emitir(req.empresaId, 'neg:nueva', { id: resultado.id });
      import('../worker.mjs').then(({ drenarOutbox }) => drenarOutbox())
        .catch(e => console.error('[conversación contacto]', e.message));
    }
    res.status(resultado.activa ? 409 : 200).json(resultado);
  } catch (e) { if (!e.status) console.error('[conversación contacto]', e.message); res.status(e.status || 500).json({ error: e.status ? e.message : 'No se pudo iniciar la conversación. Intentá nuevamente.' }); }
});

/* Reasignación desde Contactos: admin, gerencia y jefaturas de su equipo. */
r.get('/responsables/disponibles', requiere('admin','gerente','jefe'), async(req,res)=>{
  try{res.set('Cache-Control','no-store');res.json(await consultarDestinos(req));}
  catch(e){res.status(e.status||500).json({error:e.status?e.message:'Error consultando responsables.'});}
});
r.patch('/:id/responsable',requiere('admin','gerente','jefe'),async(req,res)=>{
  try{
    const resultado=await cambiarResponsable(req,req.params.id,req.body?.responsableId);
    if(!resultado.sinCambios){
      await auditar(req.empresaId,req.user.nombre,'Responsable contacto',
        resultado.cliente+': '+resultado.anterior+' → '+resultado.destino,req.ip)
        .catch(e=>console.warn('[contactos] auditoría:',e.message));
      emitir(req.empresaId,'neg:recargar',{});
      await notificar(req.empresa,'transfer',
        {origenUsr:req.user.nombre,cliente:resultado.cliente},
        [resultado.destinoId]).catch(e=>console.warn('[contactos] aviso:',e.message));
    }
    res.json({ok:true,...resultado});
  }catch(e){
    if(!e.status)console.error('[contactos] reasignación:',e.message);
    res.status(e.status||500).json({error:e.status?e.message:'No se pudo reasignar; no se aplicaron cambios.'});
  }
});

r.get('/', requiere(), async (req, res) => {
  const busca = String(req.query.q || '').trim().toLowerCase();
  const cond = ['c.empresa_id = $1'], params = [req.empresaId];
  let agenteParam = '';

  if (req.user.rol === 'agente') {
    params.push(req.user.id);
    agenteParam = `$${params.length}`;
    cond.push(`(c.responsable_id = ${agenteParam}
      OR EXISTS (SELECT 1 FROM negociaciones nx
                  WHERE nx.contacto_id=c.id AND nx.empresa_id=c.empresa_id AND nx.agente_id=${agenteParam}))`);
  } else if (req.user.rol === 'jefe') {
    const { rows } = await q('SELECT id FROM usuarios WHERE empresa_id=$1 AND (equipo=$2 OR id=$3)',
      [req.empresaId, req.user.usuario, req.user.id]);
    params.push(rows.map(x => x.id));
    cond.push(`(c.responsable_id = ANY($${params.length}::uuid[]) OR c.responsable_id IS NULL)`);
  }

  if (busca) {
    params.push(`%${busca}%`);
    cond.push(`(lower(c.nombre) LIKE $${params.length} OR c.tel LIKE $${params.length}
      OR lower(c.email) LIKE $${params.length} OR lower(c.direccion) LIKE $${params.length})`);
  }

  const activas = (req.empresa.etapas || []).filter(e => e.activa).map(e => e.id);
  params.push(activas);
  const activasParam = `$${params.length}`;
  const filtroAgente = agenteParam ? ` AND n.agente_id=${agenteParam}` : '';

  const { rows } = await q(
    `SELECT c.*, u.nombre AS responsable,
            (SELECT COUNT(*) FROM negociaciones n
              WHERE n.contacto_id=c.id${filtroAgente}) AS n_negociaciones,
            (SELECT n.etapa FROM negociaciones n
              WHERE n.contacto_id=c.id AND n.etapa = ANY(${activasParam})${filtroAgente}
              ORDER BY n.creado ASC LIMIT 1) AS etapa_abierta,
            (SELECT n.id FROM negociaciones n
              WHERE n.contacto_id=c.id AND n.etapa = ANY(${activasParam})${filtroAgente}
              ORDER BY n.creado ASC LIMIT 1) AS neg_abierta_id
       FROM contactos c LEFT JOIN usuarios u ON u.id=c.responsable_id
      WHERE ${cond.join(' AND ')} ORDER BY c.creado DESC LIMIT 500`, params);
  res.json(rows);
});

r.get('/chequeo', requiere(), async (req, res) => {
  if (!req.empresa.flags?.antiDuplicado) return res.json({ duplicado: false });
  const dup = await negActivaPorTel(req.empresa, req.query.tel);
  if (!dup) return res.json({ duplicado: false });
  const { where, params } = await alcanceSQL(req.user, req.empresaId, 'n', 3);
  const { rows } = await q(
    `SELECT n.id, n.etapa, c.nombre, u.nombre AS agente FROM negociaciones n
       JOIN contactos c ON c.id=n.contacto_id LEFT JOIN usuarios u ON u.id=n.agente_id
      WHERE n.id=$1 AND n.empresa_id=$2 ${where}`, [dup.id, req.empresaId, ...params]);
  if (!rows[0] && req.user.rol === 'agente') {
    return res.json({ duplicado: true, mensaje: 'Ese cliente ya tiene una negociación abierta.' });
  }
  res.json({ duplicado: true, ...rows[0], etapaNombre: nombreEtapa(req.empresa, rows[0].etapa) });
});

r.get('/solicitudes/pendientes', requiere(), async (req, res) => {
  const { rows } = await q(
    `SELECT s.*, c.nombre, c.tel, u.nombre AS solicitante FROM solicitudes s
       JOIN contactos c ON c.id=s.contacto_id JOIN usuarios u ON u.id=s.de_id
      WHERE s.empresa_id=$1 AND s.estado='pendiente' AND ($2 OR s.para_id=$3)`,
    [req.empresaId, req.user.rol === 'admin', req.user.id]);
  res.json(rows);
});

r.get('/export/csv', requiere('admin', 'gerente'), async (req, res) => {
  if (!req.empresa.flags?.exportar) return res.status(403).json({ error: 'función desactivada' });
  const { rows } = await q(
    'SELECT nombre,tel,email,doc,ciudad,direccion,sucursal,linea,frecuente,notas FROM contactos WHERE empresa_id=$1',
    [req.empresaId]);
  const head = ['nombre', 'tel', 'email', 'doc', 'ciudad', 'direccion', 'sucursal', 'linea', 'frecuente', 'notas'];
  const csv = [head.join(';'), ...rows.map(x => head.map(h => String(x[h] ?? '').replace(/;/g, ',')).join(';'))].join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="contactos_${req.empresa.codigo}.csv"`);
  res.send('\ufeff' + csv);
});

/** Edición de ficha por responsable o agente de negociación activa.
 * El servidor aplica el permiso; ocultar botones en UI no lo sustituye.
 */
async function editarPermitido(db,req,c) {
  if (!c) throw errorTelefono(404,'Contacto no encontrado.');
  if (['admin','gerente'].includes(req.user.rol) || c.responsable_id===req.user.id) return true;
  const activas=(req.empresa.etapas||[]).filter(e=>e.activa).map(e=>e.id);
  const {rows}=await db.query(
    'SELECT agente_id FROM negociaciones WHERE empresa_id=$1 AND contacto_id=$2 AND etapa=ANY($3)',
    [req.empresaId,c.id,activas]);
  return puedeEditarContacto(req.user,c,rows);
}

r.post('/:id/telefonos', requiere(), async(req,res)=>{
  try{
    const numero=String(req.body?.numero||'');
    const nuevo=await tx(async db=>{
      const {rows}=await db.query(
        'SELECT * FROM contactos WHERE id=$1 AND empresa_id=$2 FOR UPDATE',[req.params.id,req.empresaId]);
      if(!await editarPermitido(db,req,rows[0]))
        throw errorTelefono(403,'Solo el responsable o un agente asignado puede agregar teléfonos.');
      return agregarTelefono(db,req.empresaId,req.params.id,numero,req.body?.etiqueta);
    });
    auditar(req.empresaId,req.user.nombre,'Número adicional','Vinculación de teléfono a contacto',req.ip).catch(()=>{});
    res.json({ok:true,telefono:nuevo});
  }catch(e){if(!e.status)console.error('[contactos] agregar teléfono:',e.message);
    res.status(e.status||500).json({error:e.status?e.message:'No se pudo vincular el número.'});}
});
r.delete('/:id/telefonos/:telefonoId', requiere(), async(req,res)=>{
  try{
    await tx(async db=>{
      const {rows}=await db.query(
        'SELECT * FROM contactos WHERE id=$1 AND empresa_id=$2 FOR UPDATE',[req.params.id,req.empresaId]);
      const contacto=rows[0];
      if(!await editarPermitido(db,req,contacto))
        throw errorTelefono(403,'No tenés permiso para modificar este contacto.');
      const {rows:nums}=await db.query(
        'SELECT * FROM contacto_telefonos WHERE id=$1 AND empresa_id=$2 AND contacto_id=$3 FOR UPDATE',
        [req.params.telefonoId,req.empresaId,contacto.id]);
      const telefono=nums[0];
      if(!telefono)throw errorTelefono(404,'Número no encontrado.');
      if(telefono.tel_norm===contacto.tel_norm)
        throw errorTelefono(409,'El número principal no se puede eliminar. Agregá uno secundario.');
      const {rows:uso}=await db.query(
        'SELECT 1 FROM negociaciones WHERE empresa_id=$1 AND contacto_id=$2 AND telefono_destino=$3 AND etapa=ANY($4) LIMIT 1',
        [req.empresaId,contacto.id,telefono.numero,(req.empresa.etapas||[]).filter(x=>x.activa).map(x=>x.id)]);
      if(uso.length)throw errorTelefono(409,'Este teléfono se utiliza en una conversación activa; no se puede desvincular.');
      await db.query('DELETE FROM contacto_telefonos WHERE id=$1 AND empresa_id=$2',[telefono.id,req.empresaId]);
    });
    auditar(req.empresaId,req.user.nombre,'Número desvinculado','Teléfono secundario retirado de contacto',req.ip).catch(()=>{});
    res.json({ok:true});
  }catch(e){if(!e.status)console.error('[contactos] quitar teléfono:',e.message);
    res.status(e.status||500).json({error:e.status?e.message:'No se pudo desvincular el número.'});}
});

r.get('/:id', requiere(), async (req, res) => {
  const { rows } = await q(
    `SELECT c.*, u.nombre AS responsable FROM contactos c LEFT JOIN usuarios u ON u.id=c.responsable_id
      WHERE c.id=$1 AND c.empresa_id=$2`, [req.params.id, req.empresaId]);
  const c = rows[0];
  if (!c) return res.status(404).json({ error: 'no encontrado' });
  const { where, params } = await alcanceSQL(req.user, req.empresaId, 'n', 3);
  const [negs, ubis] = await Promise.all([
    q(`SELECT n.*, u.nombre AS agente_nombre FROM negociaciones n LEFT JOIN usuarios u ON u.id=n.agente_id
        WHERE n.contacto_id=$1 AND n.empresa_id=$2 ${where} ORDER BY n.creado DESC`,
      [c.id, req.empresaId, ...params]),
    q(`SELECT ub.* FROM ubicaciones ub
          JOIN negociaciones n ON n.id=ub.negociacion_id
         WHERE ub.contacto_id=$1 AND ub.empresa_id=$2 ${where}
         ORDER BY ub.ts DESC LIMIT 20`,
      [c.id, req.empresaId, ...params])
  ]);
  const editable=await editarPermitido({query:q},req,c);
  if (req.user.rol==='agente' && !negs.rows.length && !editable)
    return res.status(403).json({error:'No tenés acceso a esta ficha.'});
  const ganadas = negs.rows.filter(n => n.etapa === 'ganado');
  const telefonos=await telefonosContacto({query:q},req.empresaId,c.id);
  res.set('Cache-Control','no-store').json({
    ...c, editable, telefonos, negociaciones: negs.rows,
    ubicaciones: ubis.rows.map(u => ({ ...u, mapa: ubi.linkMapa(u.lat, u.lon, u.direccion || u.texto) })),
    resumen: { total: negs.rows.length, ganadas: ganadas.length,
      monto: ganadas.reduce((s, n) => s + Number(n.monto_cierre || n.valor || 0), 0),
      conversion: negs.rows.length ? Math.round(ganadas.length / negs.rows.length * 100) : 0 }
  });
});

r.post('/', requiere(), async (req, res) => {
  const emp = req.empresa, b = req.body || {};
  if (!b.nombre || !b.tel) return res.status(422).json({ error: 'Nombre y teléfono son obligatorios.' });
  if (b.iniciarNegociacion && emp.flags?.antiDuplicado) {
    const dup = await negActivaPorTel(emp, b.tel);
    if (dup) return res.status(409).json({ error: 'duplicado', negociacionId: dup.id,
      mensaje: `Ese cliente ya tiene una negociación abierta en ${nombreEtapa(emp, dup.etapa)}.` });
  }
  let c;
  try { c=await buscarPorTelefono({query:q},req.empresaId,b.tel); }
  catch(e){return res.status(e.status||500).json({error:e.message});}
  if(c) return res.status(409).json({error:'duplicado',contactoId:c.id,
    mensaje:'Este número ya está registrado en IMPAR. Abrí la ficha existente; no se creó otro contacto.'});
  if (emp.flags?.solicitudContacto && c && c.responsable_id && c.responsable_id !== req.user.id
      && c.sucursal === b.sucursal && c.linea === b.linea && req.user.rol !== 'admin') {
    const { rows: rs } = await q('SELECT nombre FROM usuarios WHERE id=$1', [c.responsable_id]);
    return res.status(409).json({ error: 'responsable', contactoId: c.id, responsable: rs[0]?.nombre,
      mensaje: `Contacto ya gestionado por ${rs[0]?.nombre} (misma sucursal y línea).` });
  }
  if (!c) c = await crearContacto(emp, { ...b, responsable_id: req.user.id,
    externos: { whatsapp: String(b.tel).replace(/\D/g, '') } });
  else await q(`UPDATE contactos SET nombre=$3, responsable_id=COALESCE(responsable_id,$4)
                 WHERE id=$1 AND empresa_id=$2`, [c.id, req.empresaId, b.nombre, req.user.id]);

  let negId = null;
  if (b.iniciarNegociacion) {
    const { rows } = await q(
      `INSERT INTO negociaciones (empresa_id,contacto_id,titulo,etapa,origen,agente_id,sucursal,linea,bot_activo)
       VALUES ($1,$2,'Alta manual','contactado','otro',$3,$4,$5,FALSE) RETURNING id`,
      [req.empresaId, c.id, req.user.id, b.sucursal || c.sucursal, b.linea || c.linea]);
    negId = rows[0].id;
    await historial(req.empresaId, negId, 'Negociación iniciada por carga de contacto', req.user.nombre);
    emitir(req.empresaId, 'neg:nueva', { id: negId });
  }
  await auditar(req.empresaId, req.user.nombre, 'Contacto', `Alta ${b.nombre}`, req.ip);
  res.json({ ok: true, id: c.id, negociacionId: negId });
});

r.patch('/:id', requiere(), async (req,res)=>{
  try{
    const b=req.body||{};
    await tx(async db=>{
      const {rows}=await db.query(
        'SELECT * FROM contactos WHERE id=$1 AND empresa_id=$2 FOR UPDATE',[req.params.id,req.empresaId]);
      const c=rows[0];
      if(!await editarPermitido(db,req,c))
        throw errorTelefono(403,'Solo el responsable o un agente asignado puede modificar esta ficha.');
      if(b.tel!==undefined && telNorm(b.tel)!==c.tel_norm)
        throw errorTelefono(422,'Para evitar duplicados, agregá otro número en «Teléfonos vinculados».');
      const valores=['nombre','email','doc','ciudad','direccion','notas'];
      const campos=[];const params=[req.params.id,req.empresaId];
      for(const key of valores)if(Object.prototype.hasOwnProperty.call(b,key)){
        const valor=String(b[key]??'').trim();
        if(valor.length>(key==='notas'?4000:250))
          throw errorTelefono(422,'El campo '+key+' supera el límite permitido.');
        if(key==='nombre' && !valor)
          throw errorTelefono(422,'El nombre no puede estar vacío.');
        params.push(valor);campos.push(key+'=$'+params.length);
      }
      if(campos.length)await db.query(
        'UPDATE contactos SET '+campos.join(',')+' WHERE id=$1 AND empresa_id=$2',params);
    });
    auditar(req.empresaId,req.user.nombre,'Ficha 360','Datos de contacto actualizados',req.ip).catch(()=>{});
    res.json({ok:true});
  }catch(e){if(!e.status)console.error('[contactos] ficha editar:',e.message);
    res.status(e.status||500).json({error:e.status?e.message:'No se pudo guardar la ficha.'});}
});

r.post('/:id/solicitar', requiere(), async (req, res) => {
  const { rows } = await q('SELECT * FROM contactos WHERE id=$1 AND empresa_id=$2', [req.params.id, req.empresaId]);
  const c = rows[0];
  if (!c) return res.status(404).json({ error: 'no encontrado' });
  await q(`INSERT INTO solicitudes (empresa_id,contacto_id,de_id,para_id) VALUES ($1,$2,$3,$4)`,
    [req.empresaId, c.id, req.user.id, c.responsable_id]);
  await notificar(req.empresa, 'solicitud', { origenUsr: req.user.nombre, cliente: c.nombre }, [c.responsable_id]);
  res.json({ ok: true });
});

r.post('/solicitudes/:sid/resolver', requiere(), async (req, res) => {
  const aceptar = !!req.body?.aceptar;
  const { rows } = await q('SELECT * FROM solicitudes WHERE id=$1 AND empresa_id=$2', [req.params.sid, req.empresaId]);
  const s = rows[0];
  if (!s) return res.status(404).json({ error: 'no encontrada' });
  await q('UPDATE solicitudes SET estado=$3, resuelta=now() WHERE id=$1 AND empresa_id=$2',
    [s.id, req.empresaId, aceptar ? 'aceptada' : 'rechazada']);
  if (aceptar) {
    const { rows: us } = await q('SELECT * FROM usuarios WHERE id=$1', [s.de_id]);
    const u = us[0];
    const { rows: cs } = await q('SELECT * FROM contactos WHERE id=$1 AND empresa_id=$2',
      [s.contacto_id, req.empresaId]);
    const c = cs[0];
    const { rows: ant } = await q('SELECT nombre FROM usuarios WHERE id=$1', [c.responsable_id]);
    const activas = (req.empresa.etapas || []).filter(e => e.activa).map(e => e.id);
    await q('UPDATE contactos SET responsable_id=$3, sucursal=$4, linea=$5 WHERE id=$1 AND empresa_id=$2',
      [c.id, req.empresaId, u.id, u.sucursal, u.linea]);
    const { rows: negs } = await q(
      'SELECT id, marcadores FROM negociaciones WHERE contacto_id=$1 AND etapa = ANY($2) AND empresa_id=$3',
      [c.id, activas, req.empresaId]);
    for (const n of negs) {
      const m = new Set(n.marcadores || []);
      if (req.empresa.flags?.marcadorTransferido) m.add('transferido');
      await q(`INSERT INTO transferencias (empresa_id,negociacion_id,de_nombre,a_nombre,por,nota)
               VALUES ($1,$2,$3,$4,$5,'Solicitud de contacto aceptada')`,
        [req.empresaId, n.id, ant[0]?.nombre || null, u.nombre, req.user.nombre]);
      await q('UPDATE negociaciones SET agente_id=$3, marcadores=$4 WHERE id=$1 AND empresa_id=$2',
        [n.id, req.empresaId, u.id, JSON.stringify([...m])]);
      await historial(req.empresaId, n.id, '⇄ Reasignada por solicitud de contacto aceptada', req.user.nombre);
    }
    await notificar(req.empresa, 'transfer', { origenUsr: req.user.nombre, cliente: c.nombre }, [u.id]);
    emitir(req.empresaId, 'neg:recargar', {});
  }
  res.json({ ok: true });
});

r.post('/import', requiere('admin', 'gerente'), async (req, res) => {
  if (!req.empresa.flags?.importar) return res.status(403).json({ error: 'función desactivada' });
  const filas = Array.isArray(req.body?.filas) ? req.body.filas : [];
  let nuevos = 0, actualizados = 0;
  for (const f of filas) {
    if (!f.tel && !f.nombre) continue;
    const { rows } = await q('SELECT id FROM contactos WHERE empresa_id=$1 AND tel_norm=$2', [req.empresaId, telNorm(f.tel)]);
    if (rows[0]) {
      await q(
        `UPDATE contactos SET nombre=COALESCE(NULLIF($2,''),nombre), email=COALESCE(NULLIF($3,''),email),
           doc=COALESCE(NULLIF($4,''),doc), ciudad=COALESCE(NULLIF($5,''),ciudad),
           direccion=COALESCE(NULLIF($6,''),direccion), sucursal=COALESCE(NULLIF($7,''),sucursal),
           linea=COALESCE(NULLIF($8,''),linea), notas=COALESCE(NULLIF($9,''),notas)
         WHERE id=$1 AND empresa_id=$10`,
        [rows[0].id, f.nombre || '', f.email || '', f.doc || '', f.ciudad || '', f.direccion || '',
         f.sucursal || '', f.linea || '', f.notas || '', req.empresaId]);
      actualizados++;
    } else {
      await crearContacto(req.empresa, { ...f, externos: { whatsapp: String(f.tel || '').replace(/\D/g, '') } });
      nuevos++;
    }
  }
  await auditar(req.empresaId, req.user.nombre, 'Importación', `${nuevos} nuevos / ${actualizados} actualizados`, req.ip);
  res.json({ ok: true, nuevos, actualizados });
});

export default r;
