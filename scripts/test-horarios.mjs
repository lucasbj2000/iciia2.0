import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { HORA,horaValida,fechaLocal,calcularAviso } from '../src/horarios-reglas.mjs';

const probar=(nombre,resultado,esperado)=>{
  assert.deepEqual(resultado,esperado,nombre);
  console.log('✓ '+nombre);
};
assert.equal(HORA.test('17:00'),true);
assert.equal(HORA.test('25:00'),false);
assert.equal(horaValida('08:00','17:00'),true);
assert.equal(horaValida('17:00','08:00'),false);
probar('no avisar antes de los diez minutos',
  calcularAviso({activo:true,salida:'17:00',hora:'16:49',decision:null}),
  {mostrar:false,objetivo:'17:00',faltan:11});
probar('avisar exactamente diez minutos antes',
  calcularAviso({activo:true,salida:'17:00',hora:'16:50'}),
  {mostrar:true,objetivo:'17:00',faltan:10});
probar('evitar recordatorio duplicado de salida normal',
  calcularAviso({activo:true,salida:'17:00',hora:'16:55',decision:'normal',confirmado_para:'17:00:00'}),
  {mostrar:false,objetivo:'17:00',faltan:5});
probar('no avisar en días no laborables',
  calcularAviso({activo:false,salida:'17:00',hora:'16:50'}),
  {mostrar:false,objetivo:null,faltan:null});
probar('avisar antes del horario extraordinario',
  calcularAviso({activo:true,salida:'17:00',hora:'18:20',decision:'extra',hasta:'18:30:00',confirmado_para:'17:00:00'}),
  {mostrar:true,objetivo:'18:30',faltan:10});
probar('no volver a avisar tras confirmar el nuevo horario',
  calcularAviso({activo:true,salida:'17:00',hora:'18:23',decision:'normal',confirmado_para:'18:30:00'}),
  {mostrar:false,objetivo:'17:00',faltan:-83});
// Casos de zona horaria de Paraguay (independiente de la del VPS).
const t=fechaLocal(new Date('2026-10-09T19:50:00.000Z'));
assert.equal(t.fecha,'2026-10-09');
assert.equal(t.hora,'16:50');
assert.equal(t.dia,5);
console.log('✓ zona horaria de Paraguay y día laboral');
const files=[
  ['src/server.mjs',"app.post('/api/sesion/renovar'"],
  ['src/server.mjs',"app.use('/api/horarios', rHorarios)"],
  ['src/auth.mjs','SEGUNDOS_SESION=Math.max(8*3600'],
  ['src/routes/horarios.mjs',"requiere('admin')"],
  ['src/migrations/012_horarios_y_salidas.sql','CREATE TABLE IF NOT EXISTS horarios_respuestas'],
  ['public/js/app.js','iniciarControlTurnos()'],
  ['public/js/app.js','iniciarRenovacion(conectarRealtime)'],
  ['public/index.html','class="sesion-verificando"'],
  ['public/js/admin.js',"'horarios','◷ Horarios laborales'"]
];
for(const [file,frag] of files){
  assert.ok(readFileSync(new URL('../'+file,import.meta.url),'utf8').includes(frag),'Falta integración: '+file);
}
console.log('✔ Horarios, aviso, sesiones e integración correctos.');
