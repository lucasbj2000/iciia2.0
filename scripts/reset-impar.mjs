// Operación explícita, nunca ejecutada durante una actualización normal.
import 'dotenv/config';
import { pool, tx, migrar } from '../src/db.mjs';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, relative, join } from 'node:path';
if (process.env.IMPAR_RESET !== 'BORRAR_DATOS_ICIIA2') throw new Error('Operación disponible solo desde preparar-impar.sh.');
if (!process.env.ADMIN_PASS || process.env.ADMIN_PASS.length < 8) throw new Error('Ingresá una contraseña de al menos 8 caracteres.');
const root = resolve('.');
const dirs = [...new Set([process.env.WA_AUTH_DIR || './auth', process.env.MEDIA_DIR || './media'].map(p => resolve(p)))];
for (const p of dirs) {
  const rel = relative(root, p);
  if (!rel || rel.startsWith('..') || rel.startsWith('/') || ['src','public','scripts','backups','.git','node_modules'].includes(rel.split('/')[0])) throw new Error('Directorio de datos inseguro: requiere revisión.');
}
const backup = join(root, 'backups', `impar-files-${Date.now()}`);
mkdirSync(backup, { recursive:true, mode:0o700 });
const moved=[];
try {
  await migrar();
  for (const [i,p] of dirs.entries()) if (existsSync(p)) { const dest=join(backup,String(i));renameSync(p,dest);moved.push([p,dest]); }
  await tx(async c => {
    // Todas las tablas operativas de este esquema; conserva historial de migraciones.
    const { rows } = await c.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename = ANY($1::text[])", [['empresas','usuarios','sucursales','marcaciones','archivos','canales','contactos','negociaciones','mensajes','ubicaciones','historial','transferencias','solicitudes','rapidas','grupos','mensajes_internos','eventos','notificaciones','auditoria','inbox','outbox']]);
    const tables=rows.map(r => '"public"."'+r.tablename.replaceAll('"','""')+'"');
    if (tables.length) await c.query('TRUNCATE '+tables.join(',')+' RESTART IDENTITY CASCADE');
  });
  const env=readFileSync('.env','utf8').replace(/^(ADMIN_USER|ADMIN_PASS|SEED_DEMO|JWT_SECRET)=.*\r?\n?/gm,'');
  writeFileSync('.env', env+'\nADMIN_USER=admin\nADMIN_PASS='+JSON.stringify(process.env.ADMIN_PASS)+'\nSEED_DEMO=false\nJWT_SECRET='+randomBytes(48).toString('hex')+'\n',{mode:0o600});
  // Proceso independiente: carga las credenciales nuevas antes de crear admin.
  console.log('Base vaciada. Sesiones y adjuntos retirados. Iniciá IMPAR para crear el administrador.');
} catch(e) {
  for (const [p,dest] of moved.reverse()) if (!existsSync(p)) renameSync(dest,p);
  throw e;
} finally { await pool.end(); }
