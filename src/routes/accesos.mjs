/** IMPAR · acceso a las cuentas, reservado al administrador.
 * No muestra ni exporta hashes o contraseñas anteriores. */
import { Router } from 'express';
import { randomInt } from 'node:crypto';
import { q, tx } from '../db.mjs';
import { requiere, hash } from '../auth.mjs';
import { auditar } from '../core.mjs';

const r = Router();
r.use(requiere('admin'));
r.use((_req,res,next)=>{res.set('Cache-Control','no-store, no-cache, must-revalidate');res.set('Pragma','no-cache');next();});
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UPPER='ABCDEFGHJKLMNPQRSTUVWXYZ';
const LOWER='abcdefghijkmnopqrstuvwxyz';
const DIGIT='23456789';
const SYMBOL='!#%&*?';
const ALL=UPPER+LOWER+DIGIT+SYMBOL;
const pick=set=>set[randomInt(set.length)];

export function claveTemporal() {
  const caracteres=[pick(UPPER),pick(LOWER),pick(DIGIT),pick(SYMBOL)];
  for(let i=caracteres.length;i<18;i++)caracteres.push(pick(ALL));
  for(let i=caracteres.length-1;i>0;i--){
    const j=randomInt(i+1);
    [caracteres[i],caracteres[j]]=[caracteres[j],caracteres[i]];
  }
  return caracteres.join('');
}

r.get('/',async(req,res,next)=>{
  try{
    const {rows}=await q(
      'SELECT id,nombre,usuario,rol,sucursal,linea,activo,ultimo_login,creado '+
      'FROM usuarios WHERE empresa_id=$1 AND NOT oculto '+
      'ORDER BY sucursal NULLS LAST,nombre,usuario',[req.empresaId]);
    res.json({empresa:'IMPAR',consultadoEn:new Date().toISOString(),usuarios:rows,
      resumen:{total:rows.length,activos:rows.filter(u=>u.activo).length,
        inactivos:rows.filter(u=>!u.activo).length}});
  }catch(e){next(e);}
});

/** Cambia únicamente claves de empleados activos; nunca de administradores.
 * Se entregan una sola vez, únicamente en la respuesta HTTPS al admin. */
r.post('/claves-temporales',async(req,res,next)=>{
  try{
    const ids=req.body?.ids;
    if(req.body?.confirmacion!=='RESTABLECER_ACCESOS' ||
       !Array.isArray(ids)||ids.length<1||ids.length>30 ||
       ids.some(id=>typeof id!=='string'||!uuid.test(id))||
       new Set(ids.map(id=>id.toLowerCase())).size!==ids.length)
      return res.status(422).json({error:'Seleccioná entre 1 y 30 empleados y confirmá el restablecimiento.'});
    if(ids.includes(req.user.id))
      return res.status(422).json({error:'Esta función nunca modifica tu propia contraseña.'});

    const entregas=await tx(async db=>{
      const {rows}=await db.query(
        'SELECT id,nombre,usuario,rol,sucursal,activo,oculto '+
        'FROM usuarios WHERE empresa_id=$1 AND id=ANY($2::uuid[]) FOR UPDATE',
        [req.empresaId,ids]);
      const indice=new Map(rows.map(u=>[u.id,u]));
      if(ids.some(id=>!indice.has(id)||indice.get(id).rol==='admin'||
        !indice.get(id).activo||indice.get(id).oculto))
        throw Object.assign(new Error('La selección incluye una cuenta inexistente, administradora o inactiva. No se modificó ninguna contraseña.'),{status:409});
      const generadas=[];
      for(const id of ids){
        const empleado=indice.get(id);
        const clave=claveTemporal();
        await db.query('UPDATE usuarios SET pass_hash=$3 WHERE id=$1 AND empresa_id=$2',
          [id,req.empresaId,await hash(clave)]);
        generadas.push({id,nombre:empleado.nombre,usuario:empleado.usuario,rol:empleado.rol,
          sucursal:empleado.sucursal,claveTemporal:clave});
      }
      return generadas;
    });
    auditar(req.empresaId,req.user.nombre,'Credenciales de acceso',
      'Generación explícita de '+entregas.length+' claves temporales para empleados',req.ip)
      .catch(e=>console.warn('[accesos] auditoría no disponible:',e.message));
    res.json({ok:true,entregas,advertencia:'Las contraseñas anteriores fueron sustituidas. Guardá estas claves ahora: no se pueden volver a consultar.'});
  }catch(e){
    if(e.status===409)return res.status(409).json({error:e.message});
    next(e);
  }
});
export default r;
