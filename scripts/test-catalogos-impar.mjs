/** IMPAR · catálogo compartido: comprobación estructural sin tocar producción. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const leer = path => readFileSync(new URL('../'+path,import.meta.url),'utf8');
const instalador=leer('scripts/instalar-catalogos-impar.mjs');
const backend=leer('src/routes/admin.mjs');
const ficha=leer('public/js/ficha.js');
const adjuntos=leer('public/js/adjuntos.js');
const wa=leer('src/channels/baileys.mjs');
const meta=leer('src/channels/meta.mjs');
execFileSync(process.execPath,['--check',new URL('./instalar-catalogos-impar.mjs',import.meta.url).pathname]);
for (const archivo of ['catalogo_impar.pdf','catalogo_papel_fotografico.pdf','catalogo_cartulinas_especiales.pdf'])
  assert.ok(instalador.includes(archivo), 'Falta '+archivo);
assert.equal((instalador.match(/id:'85a7845a-/g)||[]).length,3,'Tres registros de archivo');
assert.equal((instalador.match(/rapida:'85a7845a-/g)||[]).length,3,'Tres respuestas rápidas');
assert.ok(instalador.includes('comprobarPDF(join(carpetaPaquete,c.source))'),'Validar antes de importar');
assert.ok(instalador.includes("SELECT id FROM empresas WHERE codigo='impar' AND activa"),'No afectar otras empresas');
assert.ok(instalador.includes("ON CONFLICT(id) DO UPDATE"),'Instalación repetible');
assert.ok(instalador.includes("tipo='documento'")||instalador.includes("'documento'"),'El PDF debe ser documento');
assert.ok(instalador.includes('await tx(async db=>'),'Guardar registros juntos');
assert.ok(backend.includes("r.get('/rapidas', requiere()"),'Agentes pueden leer respuestas compartidas');
assert.ok(ficha.includes("data-arch="),'Atajo incluye archivo');
assert.ok(ficha.includes('adj.poner({ id: b.dataset.arch'),'Atajo conecta adjunto');
assert.ok(adjuntos.includes('poner: a =>'),'Selector admite archivo ya cargado');
assert.ok(wa.includes('document: bin'),'Baileys envía PDF real');
assert.ok(meta.includes("document: 'document'"),'Meta permite documentos');
console.log('✔ IMPAR: 3 catálogos empresariales, instalación idempotente y envío PDF por canales.');
