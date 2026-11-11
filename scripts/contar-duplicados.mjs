// Solo lectura: cuenta cuántas fichas repetidas unirá la actualización. No muestra nombres ni números.
// Uso: node scripts/contar-duplicados.mjs
import 'dotenv/config';
import pg from 'pg';

const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
try {
  await c.query('BEGIN READ ONLY');
  const clave = "right(regexp_replace(COALESCE(tel,''),'\\D','','g'),8)";
  const [{ grupos, fichas }] = (await c.query(
    `SELECT count(*)::int grupos, COALESCE(sum(n-1),0)::int fichas FROM (
       SELECT count(*) n FROM contactos WHERE length(regexp_replace(COALESCE(tel,''),'\\D','','g'))>=8
        GROUP BY empresa_id, ${clave} HAVING count(*)>1) x`)).rows;
  const [{ cruzados }] = (await c.query(
    `SELECT count(*)::int cruzados FROM contacto_telefonos t JOIN contactos c
        ON c.empresa_id=t.empresa_id AND c.id<>t.contacto_id AND ${clave.replace('tel', 'c.tel')}=t.tel_norm`)).rows;
  const [{ lid }] = (await c.query(
    `SELECT count(DISTINCT c.id)::int lid FROM contactos c JOIN wa_identidades_impar w
        ON w.empresa_id=c.empresa_id AND c.externos->>'whatsapp' IN (w.lid_jid, split_part(w.lid_jid,'@',1))
      WHERE COALESCE(c.tel_norm,'')=''`)).rows;
  const [{ abiertas }] = (await c.query(
    `SELECT count(*)::int abiertas FROM (SELECT contacto_id FROM negociaciones
       WHERE etapa IN ('nuevo','contactado','espera') GROUP BY contacto_id HAVING count(*)>1) x`)).rows;
  const [{ formato }] = (await c.query(
    `SELECT count(*)::int formato FROM contactos
      WHERE length(regexp_replace(COALESCE(tel,''),'\\D','','g'))>=8 AND tel_norm <> ${clave}`)).rows;
  console.log(`Mismo número en varias fichas: ${grupos} número(s), ${fichas} ficha(s) de más`);
  console.log(`Número secundario de una ficha que es principal de otra: ${cruzados}`);
  console.log(`Fichas de WhatsApp sin número con equivalencia conocida (@lid): ${lid}`);
  console.log(`Fichas con dos negociaciones abiertas: ${abiertas}`);
  console.log(`Teléfonos guardados con formato viejo (se corrigen): ${formato}`);
  await c.query('ROLLBACK');
} finally { await c.end(); }
