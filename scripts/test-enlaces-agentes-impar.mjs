/** IMPAR · Enlaces de WhatsApp por agente. Usuarios del CRM, sin red ni base real. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as E from '../src/enlaces-agentes-impar.mjs';

const leer = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const USUARIOS = [
  ['admin', 'Administrador IMPAR'], ['impar.ana.ferreira', 'Ana Paula Ferreira'], ['impar.andrea.carrillo', 'Andrea Carrillo'],
  ['impar.ariel.pavon', 'Ariel Pavón'], ['impar.belen.sanabria', 'Belén Sanabria'], ['impar.carolina.figueredo', 'Carolina Figueredo'],
  ['impar.carolina.montiel', 'Carolina Montiel'], ['impar.claudia.peralta', 'Claudia Peralta'], ['impar.cynthya.torales', 'Cynthya Torales'],
  ['impar.cesar.ozuna', 'César Ozuna'], ['impar.esteban.candia', 'Esteban Candia'], ['impar.laura.cristaldo', 'Laura Cristaldo'],
  ['impar.liz.uribe', 'Liz Uribe'], ['impar.lorena.pinho', 'Lorena Pinho'], ['impar.luis.rojas', 'Luis Fernando Rojas'],
  ['impar.nelson.cristaldo', 'Nelson Cristaldo'], ['impar.noelia.ferreira', 'Noelia Ferreira'], ['impar.noemi.diaz', 'Noemi Díaz'],
  ['impar.pamela.arroyo', 'Pamela Arroyo'], ['impar.rocio.diaz', 'Rocio Díaz'], ['impar.victor.mareco', 'Víctor Mareco'],
  ['impar.victor.torales', 'Víctor Torales']
].map(([usuario, nombre], i) => ({ id: 'u' + i, usuario, nombre, activo: true }));
const q = async (sql, p) => {
  const activos = USUARIOS.filter(u => u.activo);
  if (sql.includes("lower(usuario)='impar.'||$2"))
    return { rows: activos.filter(u => u.usuario === p[1] || u.usuario === 'impar.' + p[1]).map(({ id, nombre }) => ({ id, nombre })) };
  if (sql.startsWith('SELECT id,nombre FROM usuarios WHERE empresa_id=$1 AND activo')) return { rows: activos.map(({ id, nombre }) => ({ id, nombre })) };
  throw new Error('SQL inesperado');
};

// 1) Cada usuario: marca invisible que se lee aunque el cliente agregue su consulta.
for (const u of USUARIOS) {
  const t = E.textoPrecargado(u);
  assert.equal(E.decodificar(t), E.slugDeUsuario(u.usuario));
  assert.equal(E.quitarMarca(t), `Hola, vengo de parte de ${u.nombre} 👋`, 'El cliente ve un saludo normal');
  const escrito = t + '\nNecesito 3 resmas A4 y cartulina 🙏';
  const r = await E.leerEnlace(q, 'impar', escrito);
  assert.equal(r.agente?.id, u.id, 'Asigna a ' + u.nombre);
  assert.equal(r.via, 'marca');
  assert.equal(r.texto, `Hola, vengo de parte de ${u.nombre} 👋\nNecesito 3 resmas A4 y cartulina 🙏`, 'Se guarda sin la marca');
  assert.equal(E.enlacePublico('https://crm.iciia.tech/', u), 'https://crm.iciia.tech/w/' + E.slugDeUsuario(u.usuario));
  const wa = new URL(E.enlaceWhatsApp(u));
  assert.equal(wa.origin + wa.pathname, 'https://wa.me/595976992667');
  assert.equal(E.decodificar(wa.searchParams.get('text')), E.slugDeUsuario(u.usuario), 'La marca viaja en el enlace');
}
assert.equal(new Set(USUARIOS.map(u => E.slugDeUsuario(u.usuario))).size, USUARIOS.length, 'Enlaces únicos');

// 2) Respaldo por nombre si WhatsApp quitara los caracteres invisibles; nombres repetidos no confunden.
{
  const r = await E.leerEnlace(q, 'impar', 'Hola, vengo de parte de Carolina Montiel 👋 consulta');
  assert.equal(r.agente?.nombre, 'Carolina Montiel'); assert.equal(r.via, 'nombre');
  assert.equal((await E.leerEnlace(q, 'impar', 'hola vengo de parte de victor torales')).agente?.nombre, 'Víctor Torales', 'Sin tildes ni mayúsculas');
  assert.equal((await E.leerEnlace(q, 'impar', 'Hola, vengo de parte de Carolina 👋')).agente, null, 'Nombre incompleto no asigna');
  assert.equal((await E.leerEnlace(q, 'impar', 'Hola, quiero precios de resmas')).agente, null, 'Mensaje normal no asigna');
}

// 3) Usuario inactivo: no asigna, pero limpia la marca.
{
  const u = USUARIOS.find(x => x.usuario === 'impar.noemi.diaz'); u.activo = false;
  const r = await E.leerEnlace(q, 'impar', E.textoPrecargado(u));
  assert.equal(r.agente, null); assert.ok(!/[​‌]/.test(r.texto));
  u.activo = true;
}

// 4) Emojis compuestos intactos; textos sin marca sin cambios; slugs inválidos rechazados.
assert.equal(E.quitarMarca('Familia 👨‍👩‍👧'), 'Familia 👨‍👩‍👧');
assert.equal(E.decodificar('👨‍👩‍👧'), null);
assert.ok(!E.slugValido('../admin') && !E.slugValido('a') && E.slugValido('ana.ferreira'));

// 5) Integración con la ingesta, la ruta pública y la interfaz.
{
  const core = leer('src/core.mjs');
  const iLeer = core.indexOf('await leerEnlace(q, empresa.id, texto)'), iCont = core.indexOf('/* --- contacto --- */');
  assert.ok(iLeer > 0 && iLeer < iCont, 'La marca se lee antes de guardar el mensaje');
  assert.ok(core.includes('const recepcionImpar = !!(!enlace && esImpar'), 'Sin bot de recepción para clientes del enlace');
  assert.ok(core.includes('const agente = enlace?.id || responsableAnterior'), 'El enlace tiene prioridad en negociaciones nuevas');
  assert.ok(core.includes('if (enlace && abierta.agente_id !== enlace.id)'), 'Reasigna una negociación abierta');
  const server = leer('src/server.mjs');
  assert.ok(server.includes("app.get('/w/:usuario', limiteEnlaces, redirigirEnlace)"));
  assert.ok(server.indexOf("app.get('/w/:usuario'") < server.indexOf('express.static(join(__dirname'), 'Ruta antes de archivos estáticos');
  const ruta = leer('src/routes/enlaces-impar.mjs');
  assert.ok(ruta.includes("r.get('/', requiere('admin')") && ruta.includes("r.get('/mio', requiere()"));
  assert.ok(ruta.includes("res.set('Cache-Control', 'no-store')") && ruta.includes('res.redirect(302, generico)'));
  const sql = leer('src/migrations/028_enlaces_agentes_impar.sql');
  assert.ok(!/\b(DROP|DELETE|TRUNCATE|UPDATE)\b/i.test(sql.replace(/ON DELETE (CASCADE|SET NULL)/g, '')), 'Migración solo aditiva');
  assert.ok(leer('public/index.html').includes('id="btn-enlace"'));
  assert.ok(leer('public/js/admin.js').includes("['enlaces', '🔗 Enlaces WhatsApp']"));
}

console.log('✔ IMPAR: enlaces de WhatsApp por agente, asignación directa y respaldo por nombre.');
