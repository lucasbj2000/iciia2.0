/**
 * IMPAR · Lector ZIP limitado y sin extracción a rutas de disco.
 * Sólo devuelve archivos PDF válidos. Sin dependencias externas.
 */
import { inflateRawSync } from 'node:zlib';

export const MAX_ZIP_BYTES = 40 * 1024 * 1024;
export const MAX_PDF_BYTES = 16 * 1024 * 1024;
const MAX_ITEMS = 64;
const MAX_PDFS = 25;
const MAX_TOTAL = 80 * 1024 * 1024;

function error(texto) {
  const e = new Error(texto); e.status = 422; throw e;
}
export function extraerPDFs(zip, maxPDF = MAX_PDF_BYTES) {
  if (!Buffer.isBuffer(zip) || zip.length < 22 || zip.length > MAX_ZIP_BYTES)
    error('El ZIP está vacío o supera 40 MB.');
  // EOCD: la cabecera final se encuentra dentro de los últimos 65.557 bytes.
  let eocd = -1;
  for (let p = zip.length - 22; p >= Math.max(0, zip.length - 65557); p--) {
    if (zip.readUInt32LE(p) === 0x06054b50 && p + 22 + zip.readUInt16LE(p + 20) === zip.length) {
      eocd = p; break;
    }
  }
  if (eocd < 0) error('El ZIP está incompleto o no es válido.');
  const n = zip.readUInt16LE(eocd + 10);
  const nDisco = zip.readUInt16LE(eocd + 8);
  const centralTam = zip.readUInt32LE(eocd + 12);
  const centralIni = zip.readUInt32LE(eocd + 16);
  if (zip.readUInt16LE(eocd + 4) || zip.readUInt16LE(eocd + 6) ||
      n !== nDisco || n > MAX_ITEMS || n === 65535 ||
      centralTam === 0xffffffff || centralIni === 0xffffffff)
    error('El ZIP contiene demasiados archivos o utiliza un formato no admitido.');
  if (centralIni + centralTam > eocd) error('El índice del ZIP está dañado.');
  const resultado = [], nombres = new Set();
  let pos = centralIni, total = 0;
  for (let i = 0; i < n; i++) {
    if (pos + 46 > zip.length || zip.readUInt32LE(pos) !== 0x02014b50)
      error('Se encontró una entrada ZIP dañada.');
    const flags = zip.readUInt16LE(pos + 8);
    const metodo = zip.readUInt16LE(pos + 10);
    const comprimido = zip.readUInt32LE(pos + 20);
    const tam = zip.readUInt32LE(pos + 24);
    const nomLen = zip.readUInt16LE(pos + 28);
    const extraLen = zip.readUInt16LE(pos + 30);
    const comentarioLen = zip.readUInt16LE(pos + 32);
    const offset = zip.readUInt32LE(pos + 42);
    const modoUnix = zip.readUInt32BE(pos + 38) >>> 16;
    const fin = pos + 46 + nomLen + extraLen + comentarioLen;
    if (fin > centralIni + centralTam || fin > zip.length) error('Nombre de archivo ZIP incompleto.');
    const nombre = zip.subarray(pos + 46, pos + 46 + nomLen).toString('utf8');
    pos = fin;
    if (!nombre || nombre.includes('\0') || nombre.includes('\\') ||
      nombre.startsWith('/') || nombre.split('/').includes('..') ||
      nombre.split('/').includes('.') || /^[a-z]:/i.test(nombre)) error('El ZIP contiene rutas inseguras.');
    if (nombre.endsWith('/')) continue;
    if (modoUnix && (modoUnix & 0xf000) !== 0x8000 && (modoUnix & 0xf000) !== 0)
      error('El ZIP contiene enlaces o archivos especiales no permitidos.');
    if (!/\.pdf$/i.test(nombre)) continue; // Ignorar thumbnails y metadatos.
    if (flags & 1 || ![0,8].includes(metodo) || tam === 0xffffffff ||
      comprimido === 0xffffffff || offset === 0xffffffff)
      error('El ZIP usa cifrado, ZIP64 o una compresión no admitida.');
    if (!tam || tam > Math.min(MAX_PDF_BYTES, maxPDF) || (comprimido === 0 && tam) ||
      tam > comprimido * 120 + 4096)
      error('Un PDF supera 16 MB o tiene una compresión sospechosa.');
    total += tam;
    if (total > MAX_TOTAL || resultado.length >= MAX_PDFS) error('Máximo 25 PDF o 80 MB descomprimidos.');
    if (offset + 30 > zip.length || zip.readUInt32LE(offset) !== 0x04034b50)
      error('La entrada PDF no tiene cabecera ZIP válida.');
    if (zip.readUInt16LE(offset + 8) !== metodo) error('El método ZIP no coincide.');
    const localNombre = zip.readUInt16LE(offset + 26);
    const localExtra = zip.readUInt16LE(offset + 28);
    const inicio = offset + 30 + localNombre + localExtra;
    if (inicio + comprimido > centralIni) error('La entrada PDF está truncada.');
    const bytes = zip.subarray(inicio, inicio + comprimido);
    let pdf;
    try {
      pdf = metodo === 0 ? Buffer.from(bytes) : inflateRawSync(bytes, { maxOutputLength: Math.min(MAX_PDF_BYTES,maxPDF) });
    } catch { error('El archivo PDF no pudo descomprimirse de forma segura.'); }
    if (pdf.length !== tam || pdf.subarray(0,5).toString() !== '%PDF-' ||
      !pdf.subarray(Math.max(0,pdf.length-2048)).includes(Buffer.from('%%EOF')))
      error('El contenido de un PDF es inválido o incompleto.');
    const limpio = nombre.split('/').pop().replace(/[<>:"|?*]/g,'_').replace(/\s+/g,' ').trim().slice(0,110);
    if (!limpio) error('El PDF no tiene nombre.');
    if (nombres.has(limpio.toLowerCase())) error('Hay dos PDF con el mismo nombre: ' + limpio);
    nombres.add(limpio.toLowerCase());
    resultado.push({ nombre: limpio, buffer: pdf });
  }
  if (!resultado.length) error('El ZIP debe incluir al menos un documento PDF.');
  return resultado;
}
