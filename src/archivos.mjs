/** Almacenamiento de adjuntos: disco + metadatos en base. */
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join, extname } from 'node:path';
import { q } from './db.mjs';

export const MEDIA_DIR = process.env.MEDIA_DIR || './media';
if (!existsSync(MEDIA_DIR)) mkdirSync(MEDIA_DIR, { recursive: true });
export const MAX_BYTES = Number(process.env.MAX_UPLOAD_MB || 16) * 1024 * 1024;

const PERMITIDOS = {
  imagen: ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif'],
  video: ['video/mp4', 'video/quicktime', 'video/webm', 'video/3gpp'],
  audio: ['audio/mpeg', 'audio/ogg', 'audio/mp4', 'audio/aac', 'audio/wav', 'audio/webm', 'audio/x-m4a'],
  documento: ['application/pdf', 'text/plain', 'text/csv',
    'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/zip', 'application/x-rar-compressed', 'application/x-zip-compressed']
};
const EXT = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif',
  'image/heic': '.heic', 'image/heif': '.heif',
  'video/mp4': '.mp4', 'video/quicktime': '.mov', 'video/webm': '.webm', 'video/3gpp': '.3gp',
  'audio/mpeg': '.mp3', 'audio/ogg': '.ogg', 'audio/mp4': '.m4a', 'audio/x-m4a': '.m4a',
  'audio/aac': '.aac', 'audio/wav': '.wav', 'audio/webm': '.weba',
  'application/pdf': '.pdf', 'text/plain': '.txt', 'text/csv': '.csv',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.ms-powerpoint': '.ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  'application/zip': '.zip', 'application/x-zip-compressed': '.zip', 'application/x-rar-compressed': '.rar'
};
export const LIMITES_WA = { imagen: 5 * 1024 * 1024, video: 16 * 1024 * 1024, audio: 16 * 1024 * 1024, documento: 100 * 1024 * 1024 };

export function tipoDe(mime) {
  const m = String(mime || '').split(';')[0].trim().toLowerCase();
  for (const [tipo, lista] of Object.entries(PERMITIDOS)) if (lista.includes(m)) return tipo;
  return null;
}
export const mimePermitido = m => !!tipoDe(m);
const nombreSeguro = n => String(n || 'archivo').replace(/[/\\?%*:|"<>]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 120);
const mb = b => (b / 1048576).toFixed(b < 1048576 ? 2 : 0);

export async function guardarBuffer({ empresaId, usuarioId, buffer, mime, nombre, origen = 'agente', dims }) {
  const limpio = String(mime || '').split(';')[0].trim().toLowerCase();
  const tipo = tipoDe(limpio);
  if (!tipo) throw new Error(`Tipo de archivo no permitido (${limpio})`);
  if (buffer.length > MAX_BYTES) throw new Error(`El archivo supera el límite de ${mb(MAX_BYTES)} MB`);

  const id = randomUUID();
  const enDisco = `${id}${EXT[limpio] || extname(nombre || '') || ''}`;
  const dir = join(MEDIA_DIR, String(empresaId));
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, enDisco), buffer);

  const { rows } = await q(
    `INSERT INTO archivos (id,empresa_id,usuario_id,nombre,archivo,mime,tipo,bytes,ancho,alto,origen)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [id, empresaId, usuarioId || null, nombreSeguro(nombre), enDisco, limpio, tipo,
     buffer.length, dims?.ancho || null, dims?.alto || null, origen]);
  return conUrl(rows[0]);
}

export async function guardarDesdeUrl({ empresaId, url, mime, nombre, origen = 'cliente', headers = {} }) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 30000);
  try {
    const r = await fetch(url, { headers, signal: ctrl.signal });
    if (!r.ok) throw new Error(`No se pudo descargar el adjunto (HTTP ${r.status})`);
    const tipoReal = mime || r.headers.get('content-type') || 'application/octet-stream';
    const buf = Buffer.from(await r.arrayBuffer());
    return guardarBuffer({ empresaId, buffer: buf, mime: tipoReal, nombre: nombre || 'adjunto', origen });
  } finally { clearTimeout(t); }
}

export const conUrl = a => a ? { ...a, url: `/media/${a.empresa_id}/${a.archivo}` } : null;
export async function obtener(id, empresaId) {
  const { rows } = await q('SELECT * FROM archivos WHERE id=$1 AND empresa_id=$2', [id, empresaId]);
  return conUrl(rows[0]);
}
export async function borrar(id, empresaId) {
  const a = await obtener(id, empresaId);
  if (!a) return false;
  try { unlinkSync(join(MEDIA_DIR, String(empresaId), a.archivo)); } catch (e) {}
  await q('DELETE FROM archivos WHERE id=$1 AND empresa_id=$2', [id, empresaId]);
  return true;
}
export function urlPublica(rel) {
  const base = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
  return base ? base + rel : rel;
}
