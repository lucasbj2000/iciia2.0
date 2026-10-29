/** IMPAR: regresiones de acceso, cache y tablero. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const leer=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const auth=leer('src/auth.mjs'),server=leer('src/server.mjs'),app=leer('public/js/app.js'),
  board=leer('public/js/negociaciones.js'),routes=leer('src/routes/negociaciones.mjs'),
  sql=leer('src/migrations/024_indices_rendimiento_impar.sql');
assert.equal((auth.match(/row_to_json\(e\) AS _empresa/g)||[]).length,2,'Un JOIN por acceso');
assert.ok(auth.includes("AND e.codigo='impar' AND e.activa"));
assert.ok(auth.includes("u.id=$1 AND u.activo"));
assert.ok(auth.includes("p.eid !== user.empresa_id"));
assert.ok(auth.includes('bcrypt.compare(')&&auth.includes('jwt.verify('));
assert.ok(auth.includes('roles.length && !roles.includes(user.rol)'));
assert.ok(app.includes('await arrancar(true,r)'));
assert.ok(app.includes("const ctx=await get('/contexto')"));
assert.ok(app.includes("get('/proyecto/acceso').then"));
assert.ok(app.includes('setTimeout(()=>{ if(S.usuario) cargarClima(); },1400)'));
assert.ok(server.includes('const [sucs, empresas] = await Promise.all(['));
assert.ok(server.includes('sucursales: sucs.rows, empresas: empresas.rows'));
assert.ok(server.includes("'Cache-Control','no-cache, must-revalidate'"));
assert.ok(server.includes("'Cache-Control','no-store, must-revalidate'"));
assert.ok(server.includes('etag: true'));
assert.ok(board.includes("const resultado=await get('/negociaciones')"));
assert.ok(board.includes('Promise.allSettled(['));
assert.ok(board.includes('BLOQUE_TARJETAS = 60'));
assert.ok(board.includes("$$('[data-mas-etapa]').forEach"), 'Cada botón Mostrar más debe usar selector múltiple, no Element.forEach');
assert.ok(!board.includes("$('[data-mas-etapa]').forEach"), 'No volver a romper la vista de Negociaciones');
assert.ok(board.includes('lista.slice(0,limite)'));
assert.ok(board.includes('restantes>0')&&board.includes('limitesEtapa.set('));
assert.ok(board.includes('filtradas().filter(x=>x.etapa===e.id).length'));
assert.ok(routes.includes('SELECT_TABLERO} WHERE n.empresa_id'));
assert.ok(routes.includes('SELECT_BASE} WHERE n.id'));
assert.ok(routes.includes("r.get('/:id/resumen', requiere()"));
assert.ok(board.includes('get(`/negociaciones/${id}/resumen`)'), 'SSE no solicita historial completo');
for(const ix of ['idx_impar_tablero_actualizado','idx_impar_ubicaciones_por_negociacion','idx_impar_login_usuario'])
 assert.ok(sql.includes(ix));
assert.ok(!/DELETE\s+FROM|TRUNCATE|DROP\s+TABLE/i.test(sql));
console.log('✔ IMPAR: acceso seguro, caché revalidada y tablero progresivo.');
