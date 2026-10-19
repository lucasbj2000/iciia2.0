import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const leer = archivo => readFileSync(new URL('../'+archivo,import.meta.url),'utf8');
const index=leer('public/index.html');
const app=leer('public/js/app.js');
const contactos=leer('public/js/contactos.js');
const conversacion=leer('src/conversacion-contacto.mjs');
const principal=leer('src/principal-central-impar.mjs');
const verificacion=leer('scripts/verificar-publicacion-central.sh');

assert.ok(index.includes('name="impar-ui-build" content="busqueda-principal-20261019-3"'));
assert.ok(index.includes('/js/app.js?v=impar-busqueda-principal-20261019-3'));
assert.ok(app.includes("import { vistaContactos } from './contactos.js?v=impar-busqueda-principal-20261019-3';"));
assert.ok(contactos.includes('type="hidden" id="c-chat-canal"'));
assert.ok(!contactos.includes('No hay líneas WhatsApp habilitadas para tu sucursal'));
assert.ok(!contactos.includes('<select id="c-chat-canal"'));
assert.ok(!contactos.includes('<select required id="c-chat-canal"'));
assert.ok(conversacion.includes('consultarPrincipalCentral(db,req.empresaId)'));
assert.ok(conversacion.includes('const canales=[principal]'));
assert.ok(!principal.includes('WHERE ca.sucursal_id=$2'));
assert.ok(verificacion.includes('/api/health?impar_ver='));
assert.ok(verificacion.includes('/js/contactos.js?v=impar-busqueda-principal-20261019-3'));
assert.ok(verificacion.includes('revisión del servidor DIFERENTE'));
console.log('✔ IMPAR: selector antiguo ausente, import versionado y verificación pública preparada.');
