/** IMPAR · regresión de carga ZIP desde Administración, sin BD ni WhatsApp. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {deflateRawSync,inflateRawSync} from 'node:zlib';
import {randomBytes} from 'node:crypto';
import {extraerPDFs} from '../src/catalogos-zip-impar.mjs';
const leer=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');

function crearZip(items){
  const ficheros=[],centrales=[];
  let offset=0;
  for (const item of items){
    const nombre=Buffer.from(item.nombre,'utf8');
    const contenido=item.data || Buffer.from('%PDF-1.7\n'+randomBytes(1024).toString('hex')+'\n%%EOF');
    const method=item.method??8;
    const comprimido=method===8?deflateRawSync(contenido):contenido;
    const local=Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50,0);
    local.writeUInt16LE(20,4);local.writeUInt16LE(0x0800,6);
    local.writeUInt16LE(method,8);
    local.writeUInt32LE(comprimido.length,18);local.writeUInt32LE(contenido.length,22);
    local.writeUInt16LE(nombre.length,26);
    const central=Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50,0);
    central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);
    central.writeUInt16LE(0x0800,8);central.writeUInt16LE(method,10);
    central.writeUInt32LE(comprimido.length,20);central.writeUInt32LE(contenido.length,24);
    central.writeUInt16LE(nombre.length,28);central.writeUInt32LE(offset,42);
    ficheros.push(local,nombre,comprimido);
    centrales.push(central,nombre);
    offset+=local.length+nombre.length+comprimido.length;
  }
  const central=Buffer.concat(centrales);
  const fin=Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50,0);
  fin.writeUInt16LE(items.length,8);fin.writeUInt16LE(items.length,10);
  fin.writeUInt32LE(central.length,12);fin.writeUInt32LE(offset,16);
  return Buffer.concat([...ficheros,central,fin]);
}
const ok=crearZip([
  {nombre:'carpeta/Catálogo General.pdf'},
  {nombre:'catalogo_fotografico.pdf'},
  {nombre:'__MACOSX/.DS_Store',data:Buffer.from('ignorar')}
]);
const docs=extraerPDFs(ok);
assert.equal(docs.length,2);
assert.deepEqual(docs.map(d=>d.nombre),['Catálogo General.pdf','catalogo_fotografico.pdf']);
for (const doc of docs)assert.equal(doc.buffer.subarray(0,5).toString(),'%PDF-');
assert.equal(extraerPDFs(crearZip([{nombre:'A.PDF',method:0}])).length,1,'Soportar ZIP sin compresión');
for (const [nombre,contenido] of [
  ['travesía ZIP', crearZip([{nombre:'../invasor.pdf'}])],
  ['ruta absoluta', crearZip([{nombre:'/etc/secret.pdf'}])],
  ['ruta windows',crearZip([{nombre:'..\\secret.pdf'}])],
  ['PDF falso',crearZip([{nombre:'falso.pdf',data:Buffer.from('esto no es PDF') }])],
  ['duplicados',crearZip([{nombre:'a/c.pdf'},{nombre:'b/C.pdf'}])],
  ['demasiados',crearZip(Array.from({length:26},(_,i)=>({nombre:'archivo_'+i+'.pdf'})))],
  ['vacío',crearZip([{nombre:'notas.txt',data:Buffer.from('hola')}])],
  ['binario truncado',ok.subarray(0,50)]
]) assert.throws(()=>extraerPDFs(contenido),Error,nombre);
assert.equal(inflateRawSync(deflateRawSync(Buffer.from('hola'))).toString(),'hola');
const api=leer('src/routes/catalogos-impar.mjs');
const server=leer('src/server.mjs');
const adm=leer('public/js/admin.js');
const ui=leer('public/js/catalogos-impar.js');
const rapidas=leer('src/routes/admin.mjs');
const ficha=leer('public/js/ficha.js');
assert.ok(api.includes("router.post('/importar', requiere('admin')"),'Subida sólo admin');
assert.ok(api.includes("router.get('/', requiere('admin')"),'Listado sólo admin');
assert.ok(api.includes("router.delete('/:id',requiere('admin')"),'Retiro sólo admin');
assert.ok(api.includes("a.origen='catalogo-impar'"),'Distinguir catálogos');
assert.ok(api.includes("WHERE a.empresa_id=$1 AND a.archivo=$2"),'No duplicar archivos');
assert.ok(api.includes("INSERT INTO rapidas"),'Crear respuesta rápida para cada PDF');
assert.ok(api.includes("ambito,autor_id,archivo_id"),'Respuesta rápida empresaria y adjunto');
assert.ok(api.includes("await tx(async db=>"),'Operación atómica en PostgreSQL');
assert.ok(api.includes("join(resolve(MEDIA_DIR),String(req.empresaId))"),'Guardar en media por empresa');
assert.ok(api.includes("No eliminar el PDF"),'Conservar adjuntos enviados');
assert.ok(server.includes("app.use('/api/admin/catalogos', rCatalogosImpar)"),'Montaje de ruta');
assert.ok(server.includes("'/api/admin/catalogos/importar'"),'Exento de parser JSON');
assert.ok(adm.includes("['catalogos', '📚 Catálogos']"),'Nueva pestaña admin');
assert.ok(adm.includes("catalogos-impar.js"),'UI invocable');
assert.ok(ui.includes("new FormData()") && ui.includes("xhr.upload.onprogress"),'Subida directa con avance');
assert.ok(ui.includes("'/api/admin/catalogos/importar'"),'Destino correcto');
assert.ok(rapidas.includes("r.get('/rapidas', requiere()"),'Todos los agentes ven plantillas');
assert.ok(ficha.includes("data-arch="),'Respuestas rápidas adjuntan PDF');
console.log('✔ IMPAR: ZIP protegido, PDFs reales, sin duplicados, permisos admin y carga web para agentes.');
