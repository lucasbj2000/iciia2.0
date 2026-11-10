/* Campañas masivas IMPAR: funciones puras, lector de planillas y cableado (sin base de datos). */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';

process.env.DATABASE_URL ||= 'postgresql://sin-conexion@127.0.0.1:1/ninguna';
const C = await import('../src/campanas-impar.mjs');
const L = await import('../public/js/planilla-impar.js');
const leer = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');

/* ---------- Teléfonos ---------- */
assert.equal(C.normalizarTelefono('0981 123 456', '595'), '595981123456');
assert.equal(C.normalizarTelefono('+595 981 123456', '595'), '595981123456');
assert.equal(C.normalizarTelefono('981123456', '595'), '595981123456');
assert.equal(C.normalizarTelefono('abc', '595'), null);
assert.equal(C.normalizarTelefono('', '595'), null);

/* ---------- Plantillas ---------- */
const meta = {
  name: 'vuelta', language: 'es', status: 'APPROVED', category: 'MARKETING', parameter_format: 'POSITIONAL',
  components: [
    { type: 'HEADER', format: 'TEXT', text: 'Hola {{1}}' },
    { type: 'BODY', text: '¡Hola {{1}}! Útiles para {{2}}.' },
    { type: 'FOOTER', text: 'Respondé BAJA' },
    { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'Quiero' }] }]
};
const p = C.resumirPlantilla(meta);
assert.deepEqual(p.cuerpo.variables, ['1', '2']);
assert.deepEqual(p.encabezado.variables, ['1']);
assert.equal(p.soportada, true);
assert.equal(C.resumirPlantilla({ ...meta, components: [{ type: 'BODY', text: 'x' }, { type: 'BUTTONS', buttons: [{ type: 'COPY_CODE' }] }] }).soportada, false);
assert.equal(C.resumirPlantilla({ ...meta, components: [{ type: 'BODY', text: 'x' }, { type: 'BUTTONS', buttons: [{ type: 'URL', url: 'https://a.py/{{1}}' }] }] }).soportada, false);
assert.equal(C.resumirPlantilla({ ...meta, components: [{ type: 'HEADER', format: 'LOCATION' }, { type: 'BODY', text: 'x' }] }).soportada, false);
const nombrada = C.resumirPlantilla({ ...meta, parameter_format: 'NAMED', components: [{ type: 'HEADER', format: 'IMAGE' }, { type: 'BODY', text: '{{nombre}} hasta el {{fecha}}' }] });
assert.equal(nombrada.nombrado, true);
assert.deepEqual(nombrada.cuerpo.variables, ['nombre', 'fecha']);

/* ---------- Variables ---------- */
const destino = { nombre: 'MARÍA josé López', datos: { Colegio: 'San José' } };
assert.equal(C.valorVariable({ fuente: 'nombre' }, destino), 'María');
assert.equal(C.valorVariable({ fuente: 'nombre_completo' }, destino), 'MARÍA josé López');
assert.equal(C.valorVariable({ fuente: 'columna', columna: 'Colegio' }, destino), 'San José');
assert.equal(C.valorVariable({ fuente: 'columna', columna: 'Falta', respaldo: 'tu colegio' }, destino), 'tu colegio');
assert.equal(C.valorVariable({ fuente: 'nombre' }, { nombre: '' }), 'cliente', 'sin nombre usa «cliente»');
assert.equal(C.valorVariable({ fuente: 'fijo', valor: 'a\n\tb' }, destino), 'a b', 'sin saltos de línea (Meta los rechaza)');

const vars = { encabezado: { 1: { fuente: 'nombre' } }, cuerpo: { 1: { fuente: 'nombre' }, 2: { fuente: 'columna', columna: 'Colegio' } } };
assert.deepEqual(C.validarVariables(p, vars), []);
assert.equal(C.validarVariables(p, { cuerpo: { 1: { fuente: 'fijo', valor: ' ' } } }).length, 3);
assert.ok(C.validarVariables(nombrada, { cuerpo: { nombre: { fuente: 'nombre' }, fecha: { fuente: 'fijo', valor: '30/11' } }, media: 'http://inseguro' })
  .some(f => f.includes('https')), 'el archivo del encabezado exige https');

const comps = C.componentesEnvio(p, vars, destino);
assert.deepEqual(comps.find(c => c.type === 'body').parameters, [{ type: 'text', text: 'María' }, { type: 'text', text: 'San José' }]);
const compsN = C.componentesEnvio(nombrada, { cuerpo: { nombre: { fuente: 'nombre' }, fecha: { fuente: 'fijo', valor: '30/11' } }, media: 'https://x.py/a.jpg' }, destino);
assert.deepEqual(compsN[0], { type: 'header', parameters: [{ type: 'image', image: { link: 'https://x.py/a.jpg' } }] });
assert.equal(compsN[1].parameters[0].parameter_name, 'nombre');
assert.equal(C.textoFinal(p, vars, destino).cuerpo, '¡Hola María! Útiles para San José.');

/* ---------- Errores y bajas ---------- */
assert.equal(C.clasificarError(131042), 'pausar', 'método de pago: se pausa la campaña');
assert.equal(C.clasificarError(190), 'pausar');
assert.equal(C.clasificarError(130429), 'esperar');
assert.equal(C.clasificarError(131026), 'fallido');
assert.match(C.explicarError(131050), /no recibir mensajes de marketing/);
for (const si of ['BAJA', 'baja.', 'Stop', 'No quiero recibir más mensajes', 'no deseo promociones']) assert.ok(C.pideBaja(si), si);
for (const no of ['quiero la lista', 'baja la persiana', 'hola', '']) assert.ok(!C.pideBaja(no), no);

/* ---------- Lector de planillas ---------- */
const csv = L.tablaDesdeFilas(L.filasDeTexto('﻿nombre;telefono;nota\r\n"Pérez; Ana";0981 555 666;"dijo ""hola"""\r\nLuis;0982 111 222;\r\n'));
assert.deepEqual(csv.cabeceras, ['nombre', 'telefono', 'nota']);
assert.equal(csv.filas[0][0], 'Pérez; Ana');
assert.equal(csv.filas[0][2], 'dijo "hola"');
assert.deepEqual(L.detectarColumnas(csv), { tel: 1, nom: 0 });

const pegada = L.tablaDesdeFilas(L.filasDeTexto('0981111222\tAna\n981111222\tAna otra vez\n595981333444\tLuis\nsin número\tX'));
assert.equal(pegada.cabeceras[0], 'Columna A', 'sin cabecera: se nombran las columnas');
const dp = L.destinosDeTabla(pegada, 0, 1);
assert.equal(dp.destinos.length, 2);
assert.equal(dp.repetidos, 1, '0981… y 981… son el mismo número');
assert.equal(dp.sinNumero, 1);

const conDatos = L.destinosDeTabla(csv, 1, 0);
assert.deepEqual(conDatos.destinos[0].datos, { nota: 'dijo "hola"' }, 'las columnas extra viajan para las variables');
assert.deepEqual(L.tablaDesdeFilas([['Tel', 'Tel'], ['0981000001', '1']]).cabeceras, ['Tel', 'Tel (2)'], 'cabeceras repetidas se distinguen');

// Excel mínimo armado acá mismo (zip con deflate), con texto compartido, número y celda en línea.
function zip(archivos) {
  const locales = [], centrales = []; let offset = 0;
  for (const [nombre, texto] of Object.entries(archivos)) {
    const n = Buffer.from(nombre), datos = zlib.deflateRawSync(Buffer.from(texto)), crudo = Buffer.byteLength(texto);
    const loc = Buffer.alloc(30); loc.writeUInt32LE(0x04034b50, 0); loc.writeUInt16LE(8, 8); loc.writeUInt32LE(datos.length, 18); loc.writeUInt32LE(crudo, 22); loc.writeUInt16LE(n.length, 26);
    const cen = Buffer.alloc(46); cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(8, 10); cen.writeUInt32LE(datos.length, 20); cen.writeUInt32LE(crudo, 24); cen.writeUInt16LE(n.length, 28); cen.writeUInt32LE(offset, 42);
    locales.push(loc, n, datos); centrales.push(cen, n); offset += 30 + n.length + datos.length;
  }
  const dir = Buffer.concat(centrales), fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0); fin.writeUInt16LE(centrales.length / 2, 8); fin.writeUInt16LE(centrales.length / 2, 10); fin.writeUInt32LE(dir.length, 12); fin.writeUInt32LE(offset, 16);
  const b = Buffer.concat([...locales, dir, fin]);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.length);
}
const xlsx = zip({
  'xl/workbook.xml': '<workbook><sheets><sheet name="Clientes" sheetId="1" r:id="rId1"/></sheets></workbook>',
  'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Type="x" Target="worksheets/hoja.xml"/></Relationships>',
  'xl/sharedStrings.xml': '<sst><si><t>Nombre</t></si><si><t>Celular</t></si><si><r><t>María </t></r><r><t>&amp; Cía</t></r></si></sst>',
  'xl/worksheets/hoja.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>' +
    '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>981555102</v></c></row>' +
    '<row r="3"><c r="A3" t="inlineStr"><is><t>Ñandutí</t></is></c><c r="C3"><v>5.95981E+11</v></c></row></sheetData></worksheet>'
});
const filas = await L.filasDeXlsx(xlsx);
assert.deepEqual(filas[0], ['Nombre', 'Celular']);
assert.deepEqual(filas[1], ['María & Cía', '981555102'], 'textos compartidos con formato y números sin decimales');
assert.deepEqual(filas[2], ['Ñandutí', '', '595981000000'], 'celdas salteadas y notación científica');

/* ---------- Cableado y permisos ---------- */
const rutas = leer('src/routes/campanas.mjs');
const iPermisos = rutas.indexOf("r.put('/permisos/:usuarioId'"), iCandado = rutas.indexOf('tieneAccesoCampanas(req.user, req.empresaId))) return res.status(403)');
const iEnvio = rutas.indexOf("r.post('/',");
assert.ok(iPermisos > 0 && iCandado > iPermisos && iEnvio > iCandado, 'el candado de acceso va antes de cualquier ruta de envío');
assert.match(rutas, /r\.get\('\/permisos', soloAdmin/);
assert.match(rutas, /r\.put\('\/permisos\/:usuarioId', soloAdmin/);
assert.match(rutas, /nunca se confía en la que manda el navegador/i, 'la plantilla se vuelve a leer de Meta al crear');
const motor = leer('src/campanas-impar.mjs');
assert.match(motor, /if \(usuario\.rol === 'admin'\) return true;/);
assert.match(motor, /return usuario\.rol === 'gerente';/, 'por defecto: admin y gerentes');
assert.doesNotMatch(motor, /console\.(log|info|warn|error)\([^)]*(telefono|texto|token)/, 'sin teléfonos, textos ni tokens en logs');
assert.match(leer('src/server.mjs'), /app\.use\('\/api\/campanas', rCampanas\)/);
assert.match(leer('src/worker.mjs'), /setInterval\(\(\) => procesarCampanas\(\)/);
assert.match(leer('src/worker.mjs'), /registrarRespuestaCampana/);
assert.match(leer('src/channels/meta.mjs'), /registrarEstadoCampana/);
assert.match(leer('src/migrations/033_campanas_impar.sql'), /CREATE TABLE IF NOT EXISTS campanas_bajas/);
const app = leer('public/js/app.js');
assert.match(app, /id: 'camp'.*campanas: true/);
assert.match(app, /n\.campanas \? \(esAdmin\(\) \|\| !!S\.campanasAcceso\?\.acceso\)/);
assert.match(app, /addEventListener\('campanas:permisos'/);
const adm = leer('public/js/admin.js');
assert.match(adm, /\['campanas', 'Permisos de Campañas'\]/);
assert.match(adm, /vistaPermisosCampanas\(AB\(\)\)/);
assert.match(leer('public/index.html'), /\/campanas\.css\?v=/);
const ui = leer('public/js/campanas.js');
assert.doesNotMatch(ui, /\$\{[a-zA-Z]+\.(nombre|tel|telefono|error|texto)\}/, 'nombres, teléfonos y textos de Meta siempre pasan por esc()');

// --- Plantillas de campañas en la conversación ---
const { textoPlantilla } = C;
const tp = textoPlantilla({ nombrado: false, encabezado: { formato: 'IMAGE', texto: '', variables: [] }, cuerpo: { texto: 'Hola {{1}}, volvió el cartón dúplex', variables: ['1'] },
  pie: 'IMPAR Papeles', botones: [{ tipo: 'QUICK_REPLY', texto: 'Quiero' }] }, { cuerpo: { 1: { fuente: 'nombre' } } }, { nombre: 'Sam' });
assert.equal(tp, '🖼️ Imagen\n\nHola Sam, volvió el cartón dúplex\n\nIMPAR Papeles\n\n🔘 Quiero', 'La plantilla como la ve el cliente');
const camp = leer('src/campanas-impar.mjs');
assert.ok(camp.includes("VALUES ($1,$2,'out',$3,$4,$5,$6,'plantilla','ok') ON CONFLICT DO NOTHING") && camp.includes('ts: d.enviado, canalId: d.canal_id, negociacionId'), 'Se guarda en el chat al enviar y al responder el cliente');
assert.ok(leer('src/citas-impar.mjs').includes('FROM campana_destinos d'), 'La respuesta citada muestra la plantilla');
assert.ok(leer('public/js/ficha.js').includes('Plantilla de WhatsApp · campaña'));
assert.ok(leer('src/migrations/038_plantillas_en_chat_impar.sql').includes("'plantilla'"));

console.log('✔ Campañas IMPAR: plantillas, variables, errores, bajas, planillas y permisos');
process.exit(0);
