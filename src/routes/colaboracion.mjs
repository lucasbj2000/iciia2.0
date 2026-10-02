import { Router } from 'express';
import { requiere } from '../auth.mjs';
import { listarNotas,crearNota,listarCambios } from '../colaboracion.mjs';
import { emitir } from '../realtime.mjs';
const r=Router();
const manejar=fn=>async(req,res)=>{try{await fn(req,res);}catch(e){if(!e.status)console.error('[colaboración]',e.message);res.status(e.status||500).json({error:e.status?e.message:'No se pudo completar la operación.'});}};
r.get('/:id/notas',requiere(),manejar(async(req,res)=>res.json(await listarNotas(req,req.params.id))));
r.post('/:id/notas',requiere(),manejar(async(req,res)=>{
  const result=await crearNota(req,req.params.id,req.body||{});
  if(result.visibles.length)emitir(req.empresaId,'notas:actualizadas',{id:req.params.id},result.visibles);
  if(result.destinatarios.length&&req.empresa.flags?.notificaciones!==false)emitir(req.empresaId,'noti',{
    tipo:'mencion',titulo:'Mención en nota interna',msg:`${req.user.nombre} te mencionó en una nota interna.`,tono:'ok',ref:req.params.id
  },result.destinatarios);
  res.json({ok:true,nota:result.nota});
}));
r.get('/:id/cambios',requiere(),manejar(async(req,res)=>res.json(await listarCambios(req,{...req.query,negociacion:req.params.id}))));
export default r;
