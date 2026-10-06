import { readFileSync,existsSync,mkdirSync,writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tx } from './db.mjs';
import { MEDIA_DIR } from './archivos.mjs';
const ARCHIVO='8c243eab-7580-4dab-aa45-51de2f2f3191';
/** Recurso de empresa: se registra una sola vez y se copia al almacenamiento persistente. */
export async function prepararRecepcionImpar(){
 const imagen=readFileSync(new URL('../resources/impar-datos-bancarios.jpg',import.meta.url));
 await tx(async db=>{
  await db.query("SELECT pg_advisory_xact_lock(hashtext('impar-respuesta-bancaria'))");
  const {rows}=await db.query("SELECT id FROM empresas WHERE codigo='impar' AND activa");
  for(const e of rows){
   const dir=join(MEDIA_DIR,e.id),archivo='impar-datos-bancarios.jpg';mkdirSync(dir,{recursive:true});
   if(!existsSync(join(dir,archivo)))writeFileSync(join(dir,archivo),imagen);
   await db.query(`INSERT INTO archivos(id,empresa_id,nombre,archivo,mime,tipo,bytes,origen)
    VALUES($1,$2,'Datos bancarios IMPAR.jpg',$3,'image/jpeg','imagen',$4,'empresa') ON CONFLICT(id) DO NOTHING`,[ARCHIVO,e.id,archivo,imagen.length]);
   await db.query(`INSERT INTO rapidas(empresa_id,txt,ambito,archivo_id,media_url,media_tipo,media_nombre)
    SELECT $1,'Datos bancarios IMPAR. Por favor, enviá el comprobante de transferencia.','empresa',$2,$3,'imagen','Datos bancarios IMPAR.jpg'
    WHERE NOT EXISTS(SELECT 1 FROM rapidas WHERE empresa_id=$1 AND archivo_id=$2)`,[e.id,ARCHIVO,`/media/${e.id}/${archivo}`]);
  }
 });
}
