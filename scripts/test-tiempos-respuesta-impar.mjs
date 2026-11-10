// IMPAR: tiempos de respuesta del bot y del agente, filtros por día/semana/mes/año/rango y sala de control en movimiento.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { rangoDesdeConsulta, minutosLaborales, resumir, modoCubeta, inicioDia, fechaLocal } from '../src/tiempos-respuesta-impar.mjs';
const leer = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');

// Días en hora de Paraguay
assert.equal(fechaLocal(new Date('2026-11-10T02:30:00Z')), '2026-11-09', 'antes de medianoche en Asunción sigue siendo el día anterior');
assert.equal(inicioDia('2026-11-10').toISOString(), '2026-11-10T03:00:00.000Z');

// Rango: fechas explícitas, orden invertido, futuro recortado y período anterior de la misma duración
const ahora = new Date('2026-11-10T15:00:00Z');
let r = rangoDesdeConsulta({ desde: '2026-11-01', hasta: '2026-11-07' }, ahora);
assert.equal(r.dias, 7); assert.equal(r.finAnt.getTime(), r.ini.getTime());
assert.equal((r.ini - r.iniAnt) / 86400000, 7, 'período anterior de igual largo');
r = rangoDesdeConsulta({ desde: '2026-11-07', hasta: '2026-11-01' }, ahora);
assert.equal(r.desde, '2026-11-01', 'rango invertido se corrige');
r = rangoDesdeConsulta({ desde: '2026-11-01', hasta: '2026-12-31' }, ahora);
assert.equal(r.hasta, '2026-11-10', 'no se piden días futuros');
r = rangoDesdeConsulta({ dias: 30 }, ahora);
assert.equal(r.dias, 30); assert.equal(r.hasta, '2026-11-10');
r = rangoDesdeConsulta({ desde: '2026-01-01', hasta: '2026-12-31' }, ahora);
assert.ok(r.dias >= 300, 'un año entero entra');
assert.equal(rangoDesdeConsulta({ desde: "1'; DROP", hasta: 'x' }, ahora).dias, 30, 'fechas inválidas caen al predeterminado');

// Horario laboral: lunes a viernes 8 a 18
const reglas = { diasHabiles: [1, 2, 3, 4, 5], jornadaIni: 8, jornadaFin: 18 };
assert.equal(minutosLaborales('2026-11-09T21:50:00Z', '2026-11-10T11:10:00Z', reglas), 10, 'mensaje fuera de hora: cuenta desde que abre');
assert.equal(minutosLaborales('2026-11-13T20:55:00Z', '2026-11-16T11:05:00Z', reglas), 5 + 0 + 5, 'el fin de semana no suma');
assert.equal(minutosLaborales('2026-11-10T12:00:00Z', '2026-11-10T12:07:00Z', {}), 7, 'sin horario cargado cuenta minutos corridos');

// Resumen e índice
const s = resumir([1, 2, 3, 4, 30], 10);
assert.equal(s.n, 5); assert.equal(s.mediana, 3); assert.equal(s.indice, 80);
assert.equal(resumir([], 10).indice, null);
assert.equal(modoCubeta(7), 'dia'); assert.equal(modoCubeta(90), 'semana'); assert.equal(modoCubeta(365), 'mes');

// Pantalla de reportes
const rep = leer('public/js/reportes.js'), varios = leer('src/routes/varios.mjs');
for (const m of ['Día', 'Semana', 'Mes', 'Año', 'Rango']) assert.ok(rep.includes(`'${m}'`), 'filtro ' + m);
assert.ok(varios.includes('tiemposRespuesta(') && varios.includes('rangoDesdeConsulta(req.query)'), 'el servidor calcula los tiempos con el mismo alcance');

// Sala de control: plano tipo red sin recuadro ampliado, listas completas en movimiento
const sala = leer('public/js/sala-control.js'), salaCss = leer('public/sala.css'), salaSrv = leer('src/sala-control-impar.mjs');
assert.ok(!sala.includes('lupa') && !sala.includes('mapa-paraguay') && sala.includes('function htmlCiudades(') && sala.includes("from './planos-ciudades.js'"), 'sin mapa del país: cada sucursal con el plano de su distrito');
const { distritoDe, planoCiudad } = await import('../public/js/planos-ciudades.js');
const { DISTRITOS } = await import('../public/js/distritos-py.js');
const casos = [['Asunción', -25.2991778, -57.6356097, 'Asunción'], ['Lambaré', -25.3526614, -57.6023125, 'Lambaré'],
  ['Madame Lynch', -25.2892772, -57.5488351, 'Fernando de la Mora'], ['Ciudad del Este', -25.5050402, -54.6376159, 'Ciudad del Este'],
  ['Encarnación', -27.3300948, -55.8638838, 'Encarnación'], ['Pedro Juan Caballero', -22.5620638, -55.7210496, 'Pedro Juan Caballero']];
for (const [nombre, lat, lon, distrito] of casos) {
  assert.equal(DISTRITOS[distritoDe({ nombre, lat, lon })].n, distrito, nombre + ' cae en su distrito');
  const svg = planoCiudad({ nombre, lat, lon });
  assert.ok(svg.includes('class="plano-distrito"') && svg.includes('class="plano-pin') && svg.includes(' km</text>') && svg.includes('class="plano-norte"'), nombre + ': plano con ubicación, escala y norte');
}
assert.equal(DISTRITOS[distritoDe({ nombre: 'Sucursal nueva', lat: -25.3397, lon: -57.5088 })].n, 'San Lorenzo', 'una sucursal nueva se ubica por sus coordenadas');
assert.equal(distritoDe({ nombre: 'Sin datos' }), null);
// El punto siempre dentro del distrito: la ubicación cargada de Madame Lynch cae en Asunción, así que va al centro de Fernando de la Mora.
const fdm = planoCiudad({ nombre: 'Fernando de la Mora', lat: -25.2892772, lon: -57.5488351 });
assert.ok(fdm.includes('class="plano-pin aprox"'), 'Ubicación fuera del distrito: el punto va adentro');
assert.ok(planoCiudad({ nombre: 'Lambaré', lat: -25.3526614, lon: -57.6023125 }).includes('class="plano-pin"'), 'Ubicación correcta: se respeta');
assert.ok(sala.includes("(s.agentes ?? 1) > 0 || movimiento(s)") && salaSrv.includes("u.rol='agente'") && salaSrv.includes('AS agentes'), 'Sucursales sin personas ni movimiento no se muestran');
assert.ok(leer('public/js/distritos-py.js').includes('Cartografía Censal 2022'), 'límites oficiales del INE');
assert.ok(sala.includes("kpiPromedio('agente', 'Respuesta de agentes'") && sala.includes("kpiPromedio('bot', 'Respuesta del bot'"), 'promedio de respuesta de agentes y bot por separado');
assert.ok(salaSrv.includes('promedios: await promediosSala(promedios)'), 'el servidor manda los promedios de hoy');
const graf = leer('public/graficos-impar.css'), gjs = leer('public/js/graficos-impar.js');
assert.ok(gjs.includes('export function hoja(') && gjs.includes('export function registro(') && graf.includes('marcas de corte'), 'gráficos con el lenguaje de imprenta de IMPAR');
assert.ok(leer('public/index.html').includes('/graficos-impar.css?v='), 'estilos de gráficos cargados');
assert.ok(sala.includes('class="sala-pin sala-ciudad') && sala.includes('data-suc=') && sala.includes('sala-ondas'), 'los pulsos siguen encontrando su sucursal');
assert.ok(salaSrv.includes("ORDER BY n.entrada_etapa ASC LIMIT 150"), 'la cola trae todos los casos');
assert.ok(sala.includes("copia.setAttribute('aria-hidden', 'true')") && sala.includes('if (firmaCola !== E.firmaCola)'), 'bucle continuo sin duplicar lectura y sin reiniciarse en cada refresco');
assert.ok(/:hover \.sala-pista,[^{]*:focus-within \.sala-pista\{animation-play-state:paused\}/.test(salaCss), 'se pausa con el mouse o el foco');
assert.ok(salaCss.split('@media (prefers-reduced-motion:no-preference)')[1].includes('.sala-desliza.mueve .sala-pista{animation:sala-desliza'), 'el desplazamiento respeta «reducir movimiento»');

console.log('✔ IMPAR: tiempos de respuesta, filtros de período y sala de control en movimiento.');
