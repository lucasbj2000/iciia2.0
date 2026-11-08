/* IMPAR · lectura de listados de clientes (CSV, Excel .xlsx o lista pegada) en el navegador.
   Nada se sube al servidor hasta que se crea la campaña; sin librerías externas. */

export const MAX_FILAS = 20000;
export const MAX_BYTES = 8 * 1024 * 1024;

/* ---------- Texto (CSV / pegado) ---------- */
function separadorProbable(texto) {
  const primera = (texto.split(/\r?\n/).find(l => l.trim()) || '');
  const cuenta = c => { let n = 0, dentro = false; for (const ch of primera) { if (ch === '"') dentro = !dentro; else if (!dentro && ch === c) n++; } return n; };
  const opciones = [['\t', cuenta('\t')], [';', cuenta(';')], [',', cuenta(',')]].sort((a, b) => b[1] - a[1]);
  return opciones[0][1] ? opciones[0][0] : null;
}

/** Filas de un texto separado por tab, punto y coma o coma (respeta comillas). */
export function filasDeTexto(texto) {
  const t = String(texto || '').replace(/^﻿/, '');
  const sep = separadorProbable(t);
  const filas = []; let fila = [], celda = '', dentro = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (dentro) {
      if (ch === '"') { if (t[i + 1] === '"') { celda += '"'; i++; } else dentro = false; }
      else celda += ch;
    } else if (ch === '"' && celda === '') dentro = true;
    else if (sep && ch === sep) { fila.push(celda); celda = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && t[i + 1] === '\n') i++;
      fila.push(celda); filas.push(fila); fila = []; celda = '';
      if (filas.length > MAX_FILAS + 1) break;
    } else celda += ch;
  }
  if (celda !== '' || fila.length) { fila.push(celda); filas.push(fila); }
  return filas.map(f => f.map(c => c.trim())).filter(f => f.some(Boolean));
}

/* ---------- Excel (.xlsx = zip con XML) ---------- */
async function inflar(datos) {
  const flujo = new Blob([datos]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(flujo).arrayBuffer());
}

/** Lee los archivos de un zip (solo los nombres pedidos). */
export async function leerZip(buffer, quiere) {
  const v = new DataView(buffer), u8 = new Uint8Array(buffer), dec = new TextDecoder();
  let fin = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 66000); i--) if (v.getUint32(i, true) === 0x06054b50) { fin = i; break; }
  if (fin < 0) throw new Error('El archivo no es un Excel válido (.xlsx).');
  const total = v.getUint16(fin + 10, true);
  let p = v.getUint32(fin + 16, true);
  const salida = {};
  for (let n = 0; n < total; n++) {
    if (v.getUint32(p, true) !== 0x02014b50) break;
    const metodo = v.getUint16(p + 10, true), comprimido = v.getUint32(p + 20, true);
    const largoNombre = v.getUint16(p + 28, true), largoExtra = v.getUint16(p + 30, true), largoComent = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const nombre = dec.decode(u8.subarray(p + 46, p + 46 + largoNombre));
    p += 46 + largoNombre + largoExtra + largoComent;
    if (!quiere(nombre)) continue;
    const inicio = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    const datos = u8.subarray(inicio, inicio + comprimido);
    if (metodo === 0) salida[nombre] = dec.decode(datos);
    else if (metodo === 8) salida[nombre] = dec.decode(await inflar(datos));
  }
  return salida;
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const entidades = s => String(s).replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) =>
  e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : (ENT[e] ?? m));
const textoNodos = xml => [...String(xml).matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(m => entidades(m[1])).join('');
const columna = ref => { let n = 0; for (const ch of String(ref).replace(/\d+/g, '')) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
const numero = s => { const n = Number(s); return Number.isFinite(n) && Number.isInteger(n) && Math.abs(n) < 1e21 ? n.toFixed(0) : String(s); };

/** Filas de la primera hoja de un .xlsx. */
export async function filasDeXlsx(buffer) {
  const z = await leerZip(buffer, n => /^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|worksheets\/[^/]+\.xml)$/.test(n));
  const compartidos = [...(z['xl/sharedStrings.xml'] || '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => textoNodos(m[1]));
  let hoja = 'xl/worksheets/sheet1.xml';
  const primera = (z['xl/workbook.xml'] || '').match(/<sheet\b[^>]*\br:id="([^"]+)"/);
  if (primera) {
    const rel = [...(z['xl/_rels/workbook.xml.rels'] || '').matchAll(/<Relationship\b[^>]*>/g)].map(m => m[0])
      .find(r => r.includes(`Id="${primera[1]}"`));
    const destino = rel?.match(/Target="([^"]+)"/)?.[1];
    if (destino) hoja = destino.startsWith('/') ? destino.slice(1) : 'xl/' + destino.replace(/^\.\//, '');
  }
  const xml = z[hoja] || Object.entries(z).find(([k]) => k.startsWith('xl/worksheets/'))?.[1];
  if (!xml) throw new Error('No se encontró ninguna hoja en el Excel.');
  const filas = [];
  for (const m of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const fila = [];
    for (const c of m[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1], cuerpo = c[2] || '';
      const ref = attrs.match(/\br="([A-Z]+)\d*"/)?.[1];
      const tipo = attrs.match(/\bt="([^"]+)"/)?.[1];
      const valor = cuerpo.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      let texto = '';
      if (tipo === 's') texto = compartidos[Number(valor)] ?? '';
      else if (tipo === 'inlineStr') texto = textoNodos(cuerpo);
      else if (tipo === 'str' || tipo === 'e') texto = entidades(valor ?? '');
      else if (tipo === 'b') texto = valor === '1' ? 'VERDADERO' : 'FALSO';
      else if (valor != null) texto = numero(entidades(valor));
      fila[ref ? columna(ref) : fila.length] = String(texto).trim();
    }
    if (fila.some(Boolean)) filas.push(Array.from(fila, x => x ?? ''));
    if (filas.length > MAX_FILAS + 1) break;
  }
  return filas;
}

/* ---------- De filas a destinatarios ---------- */
const digitos = v => String(v || '').replace(/\D/g, '');
const pareceTelefono = v => digitos(v).length >= 7 && digitos(v).length <= 15 && !/[a-z]{3,}/i.test(String(v));
const letra = i => { let s = ''; i++; while (i > 0) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); } return s; };

/** Convierte filas crudas en tabla con cabeceras. Si la primera fila ya trae números, se generan cabeceras «Columna A». */
export function tablaDesdeFilas(filas) {
  const ancho = Math.max(0, ...filas.map(f => f.length));
  if (!filas.length || !ancho) return { cabeceras: [], filas: [] };
  const conCabecera = !filas[0].some(pareceTelefono);
  const vistas = new Map();
  const cabeceras = (conCabecera ? filas[0] : []).concat(Array(ancho).fill('')).slice(0, ancho).map((c, i) => {
    let nombre = String(c || '').trim().slice(0, 40) || `Columna ${letra(i)}`;
    const n = (vistas.get(nombre) || 0) + 1; vistas.set(nombre, n);
    return n > 1 ? `${nombre} (${n})` : nombre;
  });
  const cuerpo = (conCabecera ? filas.slice(1) : filas).slice(0, MAX_FILAS)
    .map(f => cabeceras.map((_, i) => String(f[i] ?? '').trim()));
  return { cabeceras, filas: cuerpo, recortado: (conCabecera ? filas.length - 1 : filas.length) > MAX_FILAS };
}

const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
/** Adivina qué columnas son el teléfono y el nombre. */
export function detectarColumnas(tabla) {
  const { cabeceras, filas } = tabla;
  let tel = cabeceras.findIndex(c => /tel|cel|whats|movil|numero|nro|phone|contacto/.test(norm(c)));
  if (tel < 0) {
    const muestra = filas.slice(0, 30);
    let mejor = -1, puntos = 0;
    cabeceras.forEach((_, i) => { const p = muestra.filter(f => pareceTelefono(f[i])).length; if (p > puntos) { puntos = p; mejor = i; } });
    tel = mejor;
  }
  let nom = cabeceras.findIndex((c, i) => i !== tel && /nombre|cliente|name|razon|apellido/.test(norm(c)));
  if (nom < 0) nom = cabeceras.findIndex((_, i) => i !== tel && filas.slice(0, 20).some(f => /[a-z]{2,}/i.test(f[i] || '') && !pareceTelefono(f[i])));
  return { tel, nom };
}

/** Destinatarios para el servidor: el resto de las columnas viaja como datos para las variables. */
export function destinosDeTabla(tabla, tel, nom) {
  const vistos = new Set(), destinos = []; let sinNumero = 0, repetidos = 0;
  for (const f of tabla.filas) {
    const d = digitos(f[tel]);
    if (d.length < 6) { sinNumero++; continue; }
    // Misma clave para 0981…, 981… y 595981… (el servidor vuelve a normalizar con el prefijo real).
    const clave = d.startsWith('595') ? d.slice(3) : d.replace(/^0+/, '');
    if (vistos.has(clave)) { repetidos++; continue; }
    vistos.add(clave);
    const datos = {};
    tabla.cabeceras.forEach((c, i) => { if (i !== tel && i !== nom && f[i]) datos[c] = f[i]; });
    destinos.push({ telefono: f[tel], nombre: nom >= 0 ? f[nom] : '', datos });
  }
  return { destinos, sinNumero, repetidos };
}

/** Lee un archivo elegido por el usuario y devuelve la tabla. */
export async function leerArchivo(archivo) {
  if (archivo.size > MAX_BYTES) throw new Error('El archivo supera 8 MB. Dividilo en partes más chicas.');
  const nombre = archivo.name.toLowerCase();
  if (nombre.endsWith('.xls')) throw new Error('Ese es el formato viejo de Excel (.xls). Guardalo como .xlsx o .csv y volvé a cargarlo.');
  if (nombre.endsWith('.xlsx')) return tablaDesdeFilas(await filasDeXlsx(await archivo.arrayBuffer()));
  let texto = await archivo.text();
  // CSV guardado por Excel en Windows suele venir en Latin-1: se detecta por el carácter de reemplazo.
  if (texto.includes('�')) texto = new TextDecoder('windows-1252').decode(await archivo.arrayBuffer());
  return tablaDesdeFilas(filasDeTexto(texto));
}
