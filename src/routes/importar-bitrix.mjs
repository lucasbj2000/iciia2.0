/** Carga Bitrix segura, exclusiva de administradores IMPAR.
 * En ninguna ruta se ejecuta UPDATE/DELETE sobre contactos existentes. */
import { Router } from 'express';
import { q,tx } from '../db.mjs';
import { requiere } from '../auth.mjs';
import { analizarCargaBitrix } from '../importar-bitrix-seguro.mjs';
import { auditar } from '../core.mjs';
import { emitir } from '../realtime.mjs';

const r=Router();
r.use(requiere('admin'));
const consultar=(text,values)=>q(text,values);
r.get('/usuarios',async(req,res,next)=>{
  try{
    const {rows}=await q('SELECT id,nombre,rol,sucursal,linea FROM usuarios WHERE empresa_id=$1 AND activo AND NOT oculto ORDER BY nombre',[req.empresaId]);
    res.set('Cache-Control','no-store').json(rows);
  }catch(e){next(e);}
});
r.post('/previsualizar',async(req,res,next)=>{
  try{
    const analisis=await analizarCargaBitrix({query:consultar},req.empresaId,req.body);
    res.set('Cache-Control','no-store').json({
      resumen:analisis.resumen,firma:analisis.firma,
      detalles:analisis.lista.map(x=>({
        fila:x.fila,estado:x.estado,motivo:x.motivo,nombre:x.nombre,
        telefonoUltimos4:x.telefonoUltimos4,
        responsableOrigen:x.responsableOrigen,responsableNombre:x.responsableNombre
      }))
    });
  }catch(e){
    if(e.status===422)return res.status(422).json({error:e.message});
    next(e);
  }
});
r.post('/aplicar',async(req,res,next)=>{
  try{
    const body=req.body||{};
    if(body.confirmacion!=='IMPORTAR_SOLO_NUEVOS'||typeof body.firma!=='string'||body.firma.length!==64)
      return res.status(422).json({error:'Se requiere revisión previa y confirmación explícita.'});
    const result=await tx(async c=>{
      // Todas las importaciones Bitrix para IMPAR se ejecutan de forma serial.
      await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',['impar:bitrix:'+req.empresaId]);
      const plan=await analizarCargaBitrix(c,req.empresaId,body);
      if(plan.firma!==body.firma){
        const e=new Error('La base cambió después de la vista previa. Volvé a previsualizar; no se modificó ningún contacto.');
        e.status=409;throw e;
      }
      let insertados=0,omitidosConcurrentes=0;
      for(const d of plan.lista.filter(x=>x.estado==='nuevo')){
        const usuario=plan.usuarios.find(u=>u.id===d.responsableId);
        if(!usuario)throw new Error('El responsable dejó de estar disponible. No se insertó ningún contacto.');
        const datos=JSON.stringify({whatsapp:d.telefono,origen_importacion:'Bitrix CSV'});
        const {rowCount}=await c.query(
          'INSERT INTO contactos (empresa_id,nombre,tel,tel_norm,responsable_id,sucursal,linea,externos) '+
          'SELECT $1,$2,$3,$4,$5,$6,$7,$8::jsonb '+
          'WHERE NOT EXISTS (SELECT 1 FROM contactos WHERE empresa_id=$1 AND '+ 
          "(tel_norm=$4 OR RIGHT(regexp_replace(tel,'[^0-9]','','g'),8)=$4 "+
          "OR RIGHT(regexp_replace(COALESCE(externos->>'whatsapp',''),'[^0-9]','','g'),8)=$4)) "+
          'AND NOT EXISTS (SELECT 1 FROM contactos WHERE empresa_id=$1 AND '+
          "lower(regexp_replace(translate(nombre,'ÁÉÍÓÚáéíóúÑñ','AEIOUaeiounn'),'[^a-zA-Z0-9]+',' ','g')) = "+
          "lower(regexp_replace(translate($2,'ÁÉÍÓÚáéíóúÑñ','AEIOUaeiounn'),'[^a-zA-Z0-9]+',' ','g'))) "+
          'RETURNING id',
          [req.empresaId,d.nombre,d.telefono,d.telefonoClave,usuario.id,
            usuario.sucursal||'',usuario.linea||'',datos]
        );
        if(rowCount)insertados++;
        else omitidosConcurrentes++;
      }
      return {insertados,omitidosConcurrentes,
        existentesSinCambios:plan.resumen.existentes,
        conflictos:plan.resumen.conflictosArchivo+plan.resumen.nombresRevisar+
          plan.resumen.invalidos+plan.resumen.sinResponsable,
        totalProcesados:plan.resumen.recibidos};
    });
    auditar(req.empresaId,req.user.nombre,'Importación Bitrix protegida',
      'Altas: '+result.insertados+'; existentes intactos: '+result.existentesSinCambios+
      '; excluidos: '+result.conflictos,req.ip).catch(()=>{});
    if(result.insertados)emitir(req.empresaId,'contactos:recargar',{nuevos:result.insertados});
    res.set('Cache-Control','no-store').json({ok:true,...result});
  }catch(e){
    if(e.status===409)return res.status(409).json({error:e.message});
    if(e.status===422)return res.status(422).json({error:e.message});
    next(e);
  }
});
export default r;
