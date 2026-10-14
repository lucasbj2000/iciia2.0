/**
 * Tests de acceso de IMPAR: sólo admin, exportación sin secreto,
 * restablecimiento intencional (no se puede leer una contraseña anterior).
 */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomInt} from 'node:crypto';
import vm from 'node:vm';

const leer=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const route=leer('src/routes/accesos.mjs');
const ui=leer('public/js/accesos.js');
const server=leer('src/server.mjs');
const admin=leer('public/js/admin.js');
const html=leer('public/index.html');

assert.ok(route.includes("r.use(requiere('admin'))"),'Todos los endpoints solo para rol admin');
assert.ok(server.includes("app.use('/api/admin/accesos', rAccesos)"),'Ruta API conectada');
assert.ok(admin.includes("'accesos','🔐 Accesos y exportación'"),'Pestaña admin visible');
assert.ok(admin.includes("m.vistaAccesos()"),'Vista accesos asociada');
assert.ok(html.includes('/accesos.css'), 'Estilos incluidos');

const primer=route.indexOf("r.get('/',");
const segundo=route.indexOf("r.post('/claves-temporales'",primer);
assert.ok(primer>=0&&segundo>primer,'Endpoints de consulta y renovación');
const lectura=route.slice(primer,segundo);
assert.ok(lectura.includes('WHERE empresa_id=$1 AND NOT oculto'));
assert.ok(lectura.includes('ultimo_login')&&lectura.includes('activo'));
assert.ok(!lectura.includes('pass_hash')&&!lectura.includes('claveTemporal')&&!lectura.includes('UPDATE usuarios'),
  'La consulta jamás expone contraseñas ni modifica cuentas');

assert.ok(route.includes("bcrypt.compare(String(req.body?.passwordAdmin||''),req.user.pass_hash)"),
  'Exige contraseña del admin antes de cambios');
assert.ok(route.includes('rateLimit('),'Protección ante intentos repetidos');
assert.ok(route.includes('FOR UPDATE'),'Cuentas bloqueadas transaccionalmente');
assert.ok(route.includes('ids.length>30'),'Máximo 30 cuentas por cambio');
assert.ok(route.includes("indice.get(id).rol==='admin'"),'Protección de administradores');
assert.ok(route.includes('!indice.get(id).activo'),'No tocar cuentas inactivas');
assert.ok(route.includes('await tx(async db=>'),'Cambio transaccional');
assert.ok(route.includes('await hash(clave)'),'Solo hashes de claves nuevas en DB');
assert.ok(!/console\.log\s*\(\s*.*claveTemporal/.test(route),'No registrar contraseñas en logs');

const inicio=route.indexOf('const UPPER=');
const fin=route.indexOf("\nr.get('/',",inicio);
assert.ok(inicio>=0&&fin>inicio);
const gen=route.slice(inicio,fin).replace('export function claveTemporal()','function claveTemporal()');
const claves=[];
for(let i=0;i<120;i++){
  const clave=vm.runInNewContext(gen+';claveTemporal()', {randomInt});
  assert.equal(clave.length,18);
  assert.match(clave,/[A-Z]/);assert.match(clave,/[a-z]/);
  assert.match(clave,/[0-9]/);assert.match(clave,/[!#%&*?]/);
  claves.push(clave);
}
assert.equal(new Set(claves).size,claves.length,'Claves únicas en las pruebas');

const textoCSV=ui.slice(ui.indexOf('const noPeligroso='),ui.indexOf('\nfunction descargarCSV('))
  .replace('export function tablaCSV(','function tablaCSV(');
const csv=vm.runInNewContext(textoCSV+
  '; tablaCSV(["Nombre","Usuario"],[["=SUM(1,1)","a;b"],["Carlos \"Prueba\"","+123"]])');
assert.ok(csv.startsWith('\uFEFF'),'Excel UTF-8');
assert.ok(csv.includes("'=SUM(1,1)"),'Fórmulas CSV neutralizadas');
assert.ok(csv.includes('"a;b"'),'Celdas delimitadas correctamente');
assert.ok(csv.includes('""Prueba""'),'Comillas CSV escapadas');

assert.ok(ui.includes("post('/admin/accesos/claves-temporales'"),'Reset solo por acción explícita');
assert.ok(ui.includes('RESTABLECER'),'Confirmación escrita');
assert.ok(ui.includes('passwordAdmin:pwd'),'Admin revalida su contraseña');
assert.ok(ui.includes('!u.activo')===false,'La elegibilidad requiere activo');
assert.ok(ui.includes("u.activo && u.rol!=='admin'"),'Admins no seleccionables');
assert.ok(ui.includes('data-acc-id='),'La selección se realiza por ID real');
assert.ok(ui.includes('exportarListado()'),'Exportación sin secretos disponible');
assert.ok(ui.includes("['Nombre','Usuario','Rol','Sucursal','Línea','Estado','Último ingreso','Contraseña actual']"),
  'Exportación con columnas operativas');
assert.ok(!ui.includes('localStorage.setItem')&&!ui.includes('sessionStorage.setItem'),
  'Las claves temporales nunca se guardan en almacenamiento navegador');
assert.ok(ui.includes("u.claveTemporal='';"),'Limpiar claves tras cerrar modal');

console.log('✔ Accesos IMPAR: API admin, comprobación, CSV, protección y renovación explícita.');
