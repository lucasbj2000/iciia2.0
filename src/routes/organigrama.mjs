import { Router } from 'express';
import { q, tx, telNorm } from '../db.mjs';
import { requiere, hash } from '../auth.mjs';
import { auditar } from '../core.mjs';
import { emitir } from '../realtime.mjs';
import { importarImpar } from '../importar-impar.mjs';
const r=Router();
const roles=new Set(['admin','gerente','jefe','agente']);
const campos='id,nombre,usuario,rol,cargo,sucursal,linea,equipo,superior_id,email,tel,activo,fecha_baja';
r.get('/',requiere('admin','gerente'),async(req,res)=>{
  const {rows}=await q(`SELECT ${campos} FROM usuarios WHERE empresa_id=$1 AND NOT oculto ORDER BY nombre`,[req.empresaId]);
  res.json(rows);
});
r.get('/vendedores',requiere('admin','gerente'),async(req,res)=>{
  const {rows}=await q(`SELECT f.datos->>'vendedor' AS vendedor,count(*)::int AS filas,
    count(*) FILTER(WHERE c.responsable_id IS NULL)::int AS sin_responsable
    FROM impar_clientes_fuente f JOIN contactos c ON c.id=f.contacto_id
    WHERE f.empresa_id=$1 GROUP BY f.datos->>'vendedor' ORDER BY vendedor`,[req.empresaId]);res.json(rows);
});
r.post('/vincular-vendedor',requiere('admin'),async(req,res)=>{
  const b=req.body||{};
  const {rows}=await q('SELECT id,sucursal FROM usuarios WHERE empresa_id=$1 AND id=$2 AND activo',[req.empresaId,b.usuario_id]);
  if(!rows[0]||!b.vendedor)return res.status(422).json({error:'Seleccioná un vendedor y un empleado activo.'});
  const result=await tx(async c=>{
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[req.empresaId]);
    return c.query(`UPDATE contactos SET responsable_id=$3,sucursal=$4 WHERE empresa_id=$1
      AND id IN(SELECT contacto_id FROM impar_clientes_fuente WHERE empresa_id=$1 AND datos->>'vendedor'=$2)`,[req.empresaId,b.vendedor,rows[0].id,rows[0].sucursal]);
  });
  await auditar(req.empresaId,req.user.nombre,'Vinculación de vendedor',`${b.vendedor} → ${rows[0].id}: ${result.rowCount} contactos`,req.ip);
  res.json({ok:true,vinculados:result.rowCount});
});
async function guardar(req,res){
  const b=req.body || {}, id=req.params.id || null;
  if(!String(b.nombre||'').trim() || !/^[a-z0-9._-]{3,80}$/i.test(b.usuario||'') || !roles.has(b.rol))
    return res.status(422).json({error:'Nombre, usuario válido y rol son obligatorios.'});
  if(!id && String(b.password||'').length<8) return res.status(422).json({error:'Contraseña de al menos 8 caracteres.'});
  const pass=b.password?await hash(b.password):null;
  if(b.password && String(b.password).length<8) return res.status(422).json({error:'Contraseña de al menos 8 caracteres.'});
  try {
    const result=await tx(async c=>{
      await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[req.empresaId]);
      const {rows}=await c.query(`SELECT ${campos} FROM usuarios WHERE empresa_id=$1 FOR UPDATE`,[req.empresaId]);
      const prev=rows.find(u=>u.id===id);
      if(id&&!prev) throw new Error('Empleado no encontrado.');
      const activo=b.activo!==false;
      if(id===req.user.id && (!activo || b.rol!=='admin')) throw new Error('No podés dar de baja ni quitar tu propio acceso administrador.');
      if(prev?.rol==='admin'&&prev.activo&&(!activo||b.rol!=='admin')&&!rows.some(u=>u.id!==id&&u.rol==='admin'&&u.activo)) throw new Error('Debe quedar al menos un administrador activo.');
      const sup=rows.find(u=>u.id===b.superior_id);
      if(b.superior_id&&(!sup||!sup.activo)) throw new Error('El superior debe ser un empleado activo de IMPAR.');
      let cursor=sup;const vistos=new Set();
      while(cursor){if(cursor.id===id||vistos.has(cursor.id))throw new Error('La jerarquía no puede contener ciclos.');vistos.add(cursor.id);cursor=rows.find(u=>u.id===cursor.superior_id);}
      if(!activo&&rows.some(u=>u.activo&&u.superior_id===id))throw new Error('Reasigná primero los empleados que dependen de esta persona.');
      const sucursal=String(b.sucursal||'').trim();
      if(sucursal && sucursal!=='Todas las sucursales'){
        const {rows:ss}=await c.query('SELECT id FROM sucursales WHERE empresa_id=$1 AND nombre=$2 AND activa',[req.empresaId,sucursal]);
        if(!ss.length)throw new Error('Seleccioná una sucursal activa.');
      }
      const values=[req.empresaId,b.nombre.trim(),b.usuario.toLowerCase(),b.rol,String(b.cargo||''),sucursal,String(b.linea||''),sup?.rol==='jefe'?sup.usuario:null,sup?.id||null,String(b.email||''),String(b.tel||''),activo];
      if(id){
        await c.query(`UPDATE usuarios SET nombre=$2,usuario=$3,rol=$4,cargo=$5,sucursal=$6,linea=$7,equipo=$8,superior_id=$9,email=$10,tel=$11,activo=$12,
          fecha_baja=CASE WHEN $12 THEN NULL ELSE COALESCE(fecha_baja,now()) END,disponibilidad=CASE WHEN $12 THEN disponibilidad ELSE 'fuera' END,pass_hash=COALESCE($14,pass_hash)
          WHERE empresa_id=$1 AND id=$13`,[...values,id,pass]);
        // Los equipos usan el usuario de su jefe: sincronizar al cambiar usuario/rol.
        await c.query(`UPDATE usuarios SET equipo=$3 WHERE empresa_id=$1 AND superior_id=$2`,[req.empresaId,id,b.rol==='jefe'?b.usuario.toLowerCase():null]);
      }else{
        const {rows:nu}=await c.query(`INSERT INTO usuarios(empresa_id,nombre,usuario,rol,cargo,sucursal,linea,equipo,superior_id,email,tel,activo,pass_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,[...values,pass]);return nu[0].id;
      }
      return id;
    });
    await auditar(req.empresaId,req.user.nombre,'Organigrama',`${id?'Actualización':'Contratación'}: ${b.nombre}${b.activo===false?' · Baja de acceso':''}`,req.ip);
    emitir(req.empresaId,'config',{});res.json({ok:true,id:result});
  }catch(e){res.status(e.code==='23505'?409:422).json({error:e.code==='23505'?'Ese usuario ya existe.':e.message});}
}
r.post('/empleados',requiere('admin'),guardar);
r.patch('/empleados/:id',requiere('admin'),guardar);
r.post('/importar',requiere('admin'),async(req,res)=>{
  try {const result=await importarImpar(req.empresaId,req.body);await auditar(req.empresaId,req.user.nombre,'Importación IMPAR',JSON.stringify(result),req.ip);emitir(req.empresaId,'config',{});res.json(result);}
  catch(e){res.status(422).json({error:e.message});}
});
export default r;
