#!/usr/bin/env node
/**
 * Recuperación segura de una sesión WhatsApp QR de ICIIA.
 *
 * Uso:
 *   node scripts/revincular-whatsapp.mjs
 *   node scripts/revincular-whatsapp.mjs <canal-id>
 *
 * Si existe un único canal whatsapp_qr lo selecciona automáticamente.
 * Si hay varios, los lista y exige indicar el UUID.
 *
 * IMPORTANTE: ejecutar con PM2 detenido para evitar escrituras simultáneas
 * sobre auth/.
 */
import 'dotenv/config';
import { existsSync, mkdirSync, renameSync } from 'node:fs';
import { resolve, join } from 'node:path';
import pg from 'pg';

const { Pool } = pg;
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('✖ Falta DATABASE_URL en .env');
  process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL, max: 1 });
const solicitado = process.argv[2] || null;
const authBase = resolve(process.env.WA_AUTH_DIR || './auth');
const backupBase = resolve('./auth-backups');
const ts = new Date().toISOString().replace(/[:.]/g, '-');

try {
  const { rows } = await pool.query(
    `SELECT id,nombre,estado,numero,activo
       FROM canales
      WHERE tipo='whatsapp_qr'
      ORDER BY nombre`
  );

  if (!rows.length) {
    console.error('✖ No hay canales WhatsApp QR configurados.');
    process.exitCode = 1;
  } else {
    let canal = solicitado ? rows.find(x => String(x.id) === solicitado) : null;

    if (!solicitado && rows.length === 1) canal = rows[0];

    if (!canal) {
      console.log('Canales WhatsApp QR disponibles:');
      for (const c of rows) {
        console.log(`  ${c.id}  · ${c.nombre} · ${c.estado} · ${c.numero || 'sin número'}`);
      }
      console.log('\nVolvé a ejecutar indicando el ID:');
      console.log('  node scripts/revincular-whatsapp.mjs <canal-id>');
      process.exitCode = 2;
    } else {
      const origen = join(authBase, String(canal.id));
      mkdirSync(backupBase, { recursive: true });

      if (existsSync(origen)) {
        const destino = join(backupBase, `${canal.id}-${ts}`);
        renameSync(origen, destino);
        console.log(`✔ Sesión anterior respaldada en ${destino}`);
      } else {
        console.log('· No había carpeta de sesión local para ese canal.');
      }

      await pool.query(
        `UPDATE canales
            SET estado='desconectado',
                ultimo_error=NULL
          WHERE id=$1`,
        [canal.id]
      );

      console.log(`✔ Canal «${canal.nombre}» marcado como desconectado`);
      console.log('');
      console.log('Siguiente paso:');
      console.log('1. pm2 start iciia-crm');
      console.log('2. Entrar a Administración → Canales');
      console.log('3. Vincular el canal y escanear el QR nuevo');
    }
  }
} finally {
  await pool.end();
}
