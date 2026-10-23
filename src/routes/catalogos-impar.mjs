/** Catálogos de IMPAR · carga ZIP desde Administración, sólo administrador. */
import { Router } from 'express';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { requiere } from '../auth.mjs';
import { q, tx } from '../db.mjs';
import { MEDIA_DIR, MAX_BYTES } from '../archivos.mjs';
import { leerMultipart } from '../multipart.mjs';
import { auditar } from '../core.mjs';
import { extraerPDFs, MAX_ZIP_BYTES } from '../catalogos-zip-impar.mjs';

const router = Router();
const existeImpar = req => req.empresa?.codigo === 'impar';
const error = (msg,status=422) => Object.assign(new Error(msg),{status});

router.get('/', requiere('admin'), async (req,res) => {
  if(!existeImpar(req))return res.status(403).json({error:'Esta sección es exclusiva de IMPAR.'});
  const {rows}=await q(
    "SELECT r.id,r.txt AS titulo,a.id AS archivo_id,a.nombre,a.bytes,a.creado "+
    "FROM rapidas r JOIN archivos a ON a.id=r.archivo_id AND a.empresa_id=r.empresa_id "+
    "WHERE r.empresa_id=$1 AND r.ambito='empresa' "+
    "AND (a.origen='catalogo-impar' OR a.archivo LIKE 'impar-catalogo-%') "+
    "ORDER BY a.creado DESC",[req.empresaId]);
  res.json({catalogos:rows,maxZipMB:Math.round(MAX_ZIP_BYTES/1048576),maxPdfMB:Math.round(Math.min(MAX_BYTES,16*1048576)/1048576)});
});

router.post('/importar', requiere('admin'), async (req,res) => {
  if(!existeImpar(req))return res.status(403).json({error:'Esta sección es exclusiva de IMPAR.'});
  const nuevos = [];
  try{
    const {archivos}=await leerMultipart(req,MAX_ZIP_BYTES);
    if(archivos.length!==1 || archivos[0].campo!=='zip' || !/\.zip$/i.test(archivos[0].nombre))
      throw error('Elegí un único archivo ZIP de catálogos.');
    const pdfs=extraerPDFs(archivos[0].buffer,Math.min(MAX_BYTES,16*1048576));
    const dir=join(resolve(MEDIA_DIR),String(req.empresaId));
    mkdirSync(dir,{recursive:true});
    const resultado=await tx(async db=>{
      await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',['impar-zip-catalogos:'+req.empresaId]);
      const incluidos=[],repetidos=[];
      for(const pdf of pdfs){
        const digest=createHash('sha256').update(pdf.buffer).digest('hex');
        const archivo='impar-catalogo-'+digest+'.pdf';
        const hay=await db.query(
          "SELECT a.id FROM archivos a JOIN rapidas r ON r.archivo_id=a.id AND r.empresa_id=a.empresa_id "+
          "WHERE a.empresa_id=$1 AND a.archivo=$2 AND r.ambito='empresa' LIMIT 1",
          [req.empresaId,archivo]);
        if(hay.rows.length){repetidos.push(pdf.nombre);continue;}
        const id=randomUUID(), idRapida=randomUUID();
        const destino=join(dir,archivo);
        if(!existsSync(destino)){
          try{writeFileSync(destino,pdf.buffer,{flag:'wx',mode:0o644});nuevos.push(destino);}
          catch(e){if(e.code!=='EEXIST')throw e;}
        }
        const titulo=pdf.nombre.replace(/\.pdf$/i,'').replace(/[_-]+/g,' ').replace(/\s+/g,' ').trim();
        const rapido='📚 '+titulo;
        await db.query(
          "INSERT INTO archivos(id,empresa_id,usuario_id,nombre,archivo,mime,tipo,bytes,origen) "+
          "VALUES($1,$2,$3,$4,$5,'application/pdf','documento',$6,'catalogo-impar')",
          [id,req.empresaId,req.user.id,pdf.nombre,archivo,pdf.buffer.length]);
        await db.query(
          "INSERT INTO rapidas(id,empresa_id,txt,ambito,autor_id,archivo_id,media_url,media_tipo,media_nombre) "+
          "VALUES($1,$2,$3,'empresa',$4,$5,$6,'documento',$7)",
          [idRapida,req.empresaId,rapido,req.user.id,id,'/media/'+req.empresaId+'/'+archivo,pdf.nombre]);
        incluidos.push({id:idRapida,nombre:pdf.nombre,bytes:pdf.buffer.length});
      }
      return {incluidos,repetidos,total:pdfs.length};
    });
    await auditar(req.empresaId,req.user.nombre,'Catálogos IMPAR',
      'ZIP: '+resultado.incluidos.length+' nuevos; '+resultado.repetidos.length+' repetidos',req.ip).catch(()=>{});
    res.json({ok:true,...resultado});
  }catch(e){
    // Sólo borrar archivos escritos en esta operación, nunca archivos existentes.
    for(const path of nuevos)try{unlinkSync(path);}catch{}
    res.status(e.status||422).json({error:e.status?e.message:'No se pudo importar el ZIP: '+e.message});
  }
});

router.delete('/:id',requiere('admin'),async(req,res)=>{
  if(!existeImpar(req))return res.status(403).json({error:'Esta sección es exclusiva de IMPAR.'});
  const {rowCount}=await q(
    "DELETE FROM rapidas r USING archivos a WHERE r.id=$1 AND r.empresa_id=$2 "+
    "AND a.id=r.archivo_id AND a.empresa_id=r.empresa_id "+
    "AND (a.origen='catalogo-impar' OR a.archivo LIKE 'impar-catalogo-%')",
    [req.params.id,req.empresaId]);
  if(!rowCount)return res.status(404).json({error:'Catálogo no encontrado.'});
  // No eliminar el PDF: podría estar referenciado en conversaciones previas.
  await auditar(req.empresaId,req.user.nombre,'Catálogos IMPAR','Catálogo retirado de respuestas rápidas',req.ip).catch(()=>{});
  res.json({ok:true});
});
export default router;
