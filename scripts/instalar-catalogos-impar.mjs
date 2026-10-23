#!/usr/bin/env node
/**
 * IMPAR · Importar catálogos PDF a las respuestas rápidas compartidas.
 * USO: node scripts/instalar-catalogos-impar.mjs [carpeta-del-paquete]
 * Nunca modifica contactos, asignaciones, conversaciones o sesiones de WhatsApp.
 */
import 'dotenv/config';
import { existsSync, mkdirSync, readFileSync, statSync, copyFileSync, renameSync, chmodSync, unlinkSync, openSync, closeSync, readSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { tx, pool } from '../src/db.mjs';
import { MEDIA_DIR, MAX_BYTES } from '../src/archivos.mjs';

export const CATALOGOS = [
  { key:'general', source:'catalogo_impar.pdf',
    id:'85a7845a-815a-4215-9040-2a1a653e8201', rapida:'85a7845a-815a-4215-9040-2a1a653e8401',
    nombre:'Catálogo general IMPAR.pdf', texto:'📗 Catálogo general IMPAR' },
  { key:'fotografico', source:'catalogo_papel_fotografico.pdf',
    id:'85a7845a-815a-4215-9040-2a1a653e8202', rapida:'85a7845a-815a-4215-9040-2a1a653e8402',
    nombre:'Catálogo de papel fotográfico IMPAR.pdf', texto:'📷 Catálogo de papel fotográfico IMPAR' },
  { key:'cartulinas', source:'catalogo_cartulinas_especiales.pdf',
    id:'85a7845a-815a-4215-9040-2a1a653e8203', rapida:'85a7845a-815a-4215-9040-2a1a653e8403',
    nombre:'Catálogo de cartulinas especiales IMPAR.pdf', texto:'🎨 Catálogo de cartulinas especiales IMPAR' }
];
const carpetaPaquete = resolve(process.argv.find(x=>!x.startsWith('--') && x!==process.argv[0] && x!==process.argv[1]) || 'catalogos-impar');

export function comprobarPDF(ruta) {
  if (!existsSync(ruta)) throw new Error('Falta archivo PDF: ' + ruta);
  const size=statSync(ruta).size;
  if(size<1024 || size>MAX_BYTES) throw new Error('PDF fuera de límite de subida: '+ruta+' ('+size+' bytes)');
  const file=openSync(ruta,'r');
  try {
    const header=Buffer.alloc(5);readSync(file,header,0,5,0);
    if(header.toString()!=='%PDF-')throw new Error('No es PDF: '+ruta);
    const tail=Buffer.alloc(Math.min(size,2048));readSync(file,tail,0,tail.length,size-tail.length);
    if(!tail.includes(Buffer.from('%%EOF')))throw new Error('PDF incompleto: '+ruta);
  }finally{closeSync(file);}
  const hash=createHash('sha256').update(readFileSync(ruta)).digest('hex').slice(0,16);
  return {size,hash};
}

async function instalar(){
  const archivos=CATALOGOS.map(c=>({...c,ruta:join(carpetaPaquete,c.source),
    ...comprobarPDF(join(carpetaPaquete,c.source))}));
  if(process.argv.includes('--verificar')){
    archivos.forEach(c=>console.log('✔ '+c.nombre+' ('+(c.size/1048576).toFixed(1)+' MB)'));
    return;
  }
  if(!process.env.DATABASE_URL)throw new Error('Falta DATABASE_URL de la instancia IMPAR');
  const empresa=await pool.query("SELECT id FROM empresas WHERE codigo='impar' AND activa");
  if(empresa.rows.length!==1)throw new Error('Se necesita una única empresa IMPAR activa. No se cambió nada.');
  const empresaId=empresa.rows[0].id;
  const carpeta=join(resolve(MEDIA_DIR),String(empresaId));
  mkdirSync(carpeta,{recursive:true});
  for(const c of archivos){
    c.nombreDisco='impar-catalogo-'+c.key+'-'+c.hash+'.pdf';
    const target=join(carpeta,c.nombreDisco);
    if(!existsSync(target)){
      const temp=join(carpeta,'.impar-pdf-'+randomUUID()+'.tmp');
      try{
        copyFileSync(c.ruta,temp);chmodSync(temp,0o644);renameSync(temp,target);
      }finally{if(existsSync(temp))unlinkSync(temp);}
    }
    if(statSync(target).size!==c.size)throw new Error('Copia incompleta: '+target);
  }
  await tx(async db=>{
    await db.query("SELECT pg_advisory_xact_lock(hashtext('impar-catalogos-2026'))");
    for(const c of archivos){
      const a=await db.query(
        "INSERT INTO archivos(id,empresa_id,nombre,archivo,mime,tipo,bytes,origen) "+
        "VALUES($1,$2,$3,$4,'application/pdf','documento',$5,'empresa') "+
        "ON CONFLICT(id) DO UPDATE SET nombre=EXCLUDED.nombre,archivo=EXCLUDED.archivo, "+
        "mime=EXCLUDED.mime,tipo=EXCLUDED.tipo,bytes=EXCLUDED.bytes,origen='empresa' "+
        "WHERE archivos.empresa_id=EXCLUDED.empresa_id",
        [c.id,empresaId,c.nombre,c.nombreDisco,c.size]);
      if(a.rowCount!==1)throw new Error('Colisión de registro '+c.id);
      const url='/media/'+empresaId+'/'+c.nombreDisco;
      const r=await db.query(
        "INSERT INTO rapidas(id,empresa_id,txt,ambito,archivo_id,media_url,media_tipo,media_nombre) "+
        "VALUES($1,$2,$3,'empresa',$4,$5,'documento',$6) "+
        "ON CONFLICT(id) DO UPDATE SET txt=EXCLUDED.txt,ambito='empresa', "+
        "archivo_id=EXCLUDED.archivo_id,media_url=EXCLUDED.media_url, "+
        "media_tipo='documento',media_nombre=EXCLUDED.media_nombre "+
        "WHERE rapidas.empresa_id=EXCLUDED.empresa_id",
        [c.rapida,empresaId,c.texto,c.id,url,c.nombre]);
      if(r.rowCount!==1)throw new Error('Colisión de respuesta rápida '+c.rapida);
    }
  });
  console.log('✔ 3 catálogos IMPAR disponibles en Respuestas y acciones → Respuestas rápidas.');
  console.log('✔ Archivos PDF guardados en media/ persistente para envío por WhatsApp.');
  console.log('  No se modificaron contactos, conversaciones, responsables ni sesiones.');
}
try { await instalar(); }
catch(error){console.error('✖ '+error.message);process.exitCode=1;}
finally { await pool.end(); }
