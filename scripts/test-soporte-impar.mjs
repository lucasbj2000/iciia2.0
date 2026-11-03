#!/usr/bin/env node
/** IMPAR · Soporte interno, reportes y cierre de sesión. Sin base de datos ni navegador. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  validarSolicitud, estadoInicial, rolesSoporte, puedeVer, accionesDisponibles, decidir, resumir
} from '../src/soporte-impar.mjs';

const leer = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const G1 = 'g1', G2 = 'g2', AG = 'a1', AG2 = 'a2', AD = 'ad', OB = 'ob';
const cfg = { aprobadores: [G1, G2], observadores: [OB] };
const u = (id, rol) => ({ id, rol });
const sol = (estado, extra = {}) => ({ id: 's', autor_id: AG, tipo: 'falla', estado, ...extra });

// Validación
assert.ok(validarSolicitud({}).error, 'exige tipo');
assert.ok(validarSolicitud({ tipo: 'falla', titulo: 'ab', descripcion: 'x'.repeat(20) }).error, 'exige título');
assert.ok(validarSolicitud({ tipo: 'falla', titulo: 'Título ok', descripcion: 'corto' }).error, 'exige detalle');
const ok = validarSolicitud({ tipo: 'mejora', titulo: '  Filtrar   por ciudad ', descripcion: 'Poder filtrar contactos por ciudad.',
  modulo: 'inventado', impacto: 'raro', contexto: { navegador: 'x'.repeat(500), extra: 'no' } });
assert.equal(ok.datos.titulo, 'Filtrar por ciudad');
assert.equal(ok.datos.modulo, 'otro'); assert.equal(ok.datos.impacto, 'medio');
assert.equal(ok.datos.contexto.navegador.length, 200); assert.ok(!('extra' in ok.datos.contexto), 'solo datos técnicos previstos');

// Estado inicial
assert.equal(estadoInicial({ aprobadores: [G1], autorId: AG, autorRol: 'agente' }), 'gerencia');
assert.equal(estadoInicial({ aprobadores: [], autorId: AG, autorRol: 'agente' }), 'administracion', 'sin aprobadores va a administración');
assert.equal(estadoInicial({ aprobadores: [G1], autorId: G1, autorRol: 'gerente' }), 'administracion', 'nadie se aprueba solo');
assert.equal(estadoInicial({ aprobadores: [G1, G2], autorId: G1, autorRol: 'gerente' }), 'gerencia');

// Roles y visibilidad
assert.equal(rolesSoporte(u(G1, 'gerente'), cfg).esAprobador, true);
assert.equal(rolesSoporte(u(AG, 'agente'), { aprobadores: [AG] }).esAprobador, false, 'solo gerentes aprueban');
assert.equal(rolesSoporte(u('g3', 'gerente'), cfg).veTodo, false, 'gerente no elegido no ve todo');
assert.ok(puedeVer(u(AG, 'agente'), sol('gerencia'), cfg), 'el autor ve la suya');
assert.ok(!puedeVer(u(AG2, 'agente'), sol('gerencia'), cfg), 'otro agente no la ve');
assert.ok(puedeVer(u(OB, 'agente'), sol('gerencia'), cfg), 'observador la ve');

// Acciones
assert.deepEqual(accionesDisponibles(u(G1, 'gerente'), sol('gerencia'), cfg), ['aprobar', 'rechazar']);
assert.deepEqual(accionesDisponibles(u(G1, 'gerente'), sol('gerencia', { autor_id: G1 }), cfg), [], 'no aprueba la propia');
assert.deepEqual(accionesDisponibles(u(OB, 'agente'), sol('gerencia'), cfg), [], 'observador solo lee');
assert.deepEqual(accionesDisponibles(u(G1, 'gerente'), sol('administracion'), cfg), [], 'gerente no confirma');
assert.deepEqual(accionesDisponibles(u(AD, 'admin'), sol('administracion'), cfg), ['confirmar', 'rechazar']);
assert.deepEqual(accionesDisponibles(u(AD, 'admin'), sol('administracion', { tipo: 'consulta' }), cfg), ['confirmar', 'rechazar', 'resolver']);
assert.deepEqual(accionesDisponibles(u(AD, 'admin'), sol('aprobada'), cfg), ['resolver']);
assert.deepEqual(accionesDisponibles(u(AD, 'admin'), sol('gerencia'), cfg), ['aprobar', 'rechazar'], 'admin destraba gerencia');
assert.deepEqual(accionesDisponibles(u(AD, 'admin'), sol('resuelta'), cfg), []);

// Decisiones
assert.ok(decidir(u(G1, 'gerente'), sol('gerencia'), cfg, 'rechazar', '').error, 'rechazo con motivo');
assert.equal(decidir(u(G1, 'gerente'), sol('gerencia'), cfg, 'aprobar').estado, 'administracion');
assert.ok(decidir(u(AD, 'admin'), sol('administracion', { tipo: 'consulta' }), cfg, 'resolver', '').error, 'consulta exige respuesta');
assert.equal(decidir(u(AD, 'admin'), sol('aprobada'), cfg, 'resolver', '').estado, 'resuelta');
assert.ok(decidir(u(AG, 'agente'), sol('gerencia'), cfg, 'aprobar').error, 'el autor no decide');
assert.ok(decidir(u(AD, 'admin'), sol('gerencia'), cfg, 'borrar').error, 'acción desconocida');

// Resumen
const ahora = Date.parse('2026-11-03T12:00:00Z');
const r = resumir([
  { tipo: 'falla', modulo: 'chat', impacto: 'alto', estado: 'gerencia', creado: '2026-11-03T08:00:00Z' },
  { tipo: 'falla', modulo: 'chat', impacto: 'bajo', estado: 'resuelta', creado: '2026-11-01T12:00:00Z', gerente_ts: '2026-11-01T14:00:00Z', resuelta_ts: '2026-11-02T12:00:00Z' },
  { tipo: 'consulta', modulo: 'reportes', impacto: 'medio', estado: 'rechazada', creado: '2026-11-02T12:00:00Z' }
], ahora);
assert.equal(r.total, 3); assert.equal(r.abiertas, 1); assert.equal(r.fallasAbiertasAlto, 1);
assert.equal(r.porTipo.mejora, 0, 'todos los tipos aparecen aunque estén en cero');
assert.equal(r.fallasPorModulo[0].modulo, 'chat'); assert.equal(r.fallasPorModulo[0].n, 2);
assert.equal(r.horasGerencia, 2); assert.equal(r.horasResolucion, 24); assert.equal(r.masAntigua, 4);

// Conexiones: migración, rutas, menú, notificaciones y tiempo real
const mig = leer('src/migrations/029_soporte_impar.sql');
for (const t of ['soporte_config', 'soporte_solicitudes', 'soporte_eventos']) assert.ok(mig.includes('CREATE TABLE IF NOT EXISTS ' + t), t);
const server = leer('src/server.mjs'), rutas = leer('src/routes/soporte.mjs');
assert.ok(server.includes("app.use('/api/soporte', rSoporte)"));
assert.ok(rutas.includes("r.put('/config', requiere('admin')"), 'solo admin configura');
assert.ok(rutas.includes("filter(id => rol.get(id) === 'gerente')"), 'aprobadores solo gerentes');
assert.ok(rutas.includes('FOR UPDATE'), 'decisiones bloquean la fila');
const app = leer('public/js/app.js');
assert.ok(app.includes("{ id: 'sop', t: 'Soporte'") && app.includes('n.siempre ? true'), 'Soporte visible para todos');
assert.ok(app.includes("if (tipo === 'soporte')"), 'la notificación abre la solicitud');
assert.ok(app.includes("es.addEventListener('soporte'"), 'tiempo real');
const index = leer('public/index.html');
assert.ok(index.includes('/soporte.css') && index.includes('/reportes.css'));

// Cierre de sesión: la limpieza de ayudas usaba $(…).forEach y cortaba el cierre.
const ayudas = leer('public/js/ayudas.js');
assert.ok(!/[^$]\$\('\[data-guia-(activa|nav)\]'\)\.forEach/.test(ayudas), 'quitarMarcas usa $$');
assert.ok(/finally \{ salir\(\); \}/.test(app), 'el botón cierra la sesión aunque falle la limpieza');
for (const f of ['public/js/ayudas.js', 'public/js/admin.js'])
  assert.ok(!/[^$]\$\((['"`])[^)]*\)\.forEach/.test(leer(f)), `${f}: sin $(…).forEach`);

// Errores async no detienen el proceso
assert.ok(/^import 'dotenv\/config';\n(?:\/\/.*\n)?import '\.\/async-errors\.mjs';/.test(server), 'async-errors se carga al inicio');

// Reportes: mismo endpoint y alcance; comparación con el período anterior con el mismo filtro de permisos
const varios = leer('src/routes/varios.mjs');
assert.ok(varios.includes('anterior: ant[0]') && /AND n\.creado < now\(\) - \(\$2 \|\| ' days'\)::interval \$\{where\}/.test(varios), 'período anterior con alcance');
assert.ok(leer('public/js/modulos.js').includes("export { vistaReportes } from './reportes.js'"));
const rep = leer('public/js/reportes.js');
assert.ok(rep.includes("get(`/reportes?dias=${RANGO}`)"), 'usa el endpoint con permisos del servidor');

console.log('✔ IMPAR: soporte (flujo, permisos, resumen), reportes y cierre de sesión verificados.');
