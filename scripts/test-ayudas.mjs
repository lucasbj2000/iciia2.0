#!/usr/bin/env node
/** Pruebas sin credenciales ni acceso a producción para las reglas de ayuda. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolverGuia } from '../src/guia-reglas.mjs';

const casos = [
  ['inicio seguro sin activación', {}, {}, false, false],
  ['habilitado para todos', {general:true}, {modo:'heredar'}, true, true],
  ['excepción oculta a un empleado', {general:true}, {modo:'ocultar'}, false, false],
  ['excepción habilita a un empleado', {general:false}, {modo:'mostrar'}, true, true],
  ['mini ayudas desactivadas sin cerrar la guía', {general:true,mini_ayudas:false}, {}, true, false],
  ['recorrido oculto tras completarse', {general:true,bienvenida:true}, {recorrido_visto:true}, true, true]
];
for(const [titulo,config,usuario,enabled,mini] of casos) {
  const res=resolverGuia(config,usuario);
  assert.equal(res.habilitado,enabled,titulo);
  assert.equal(res.mini_ayudas,mini,titulo);
  if(titulo==='recorrido oculto tras completarse')assert.equal(res.recorrido_visto,true);
  if(titulo==='mini ayudas desactivadas sin cerrar la guía')assert.equal(res.bienvenida,true);
  console.log('✓ '+titulo);
}
const archivos = [
  ['src/server.mjs',"app.use('/api/ayudas', rAyudas)"],
  ['src/routes/ayudas.mjs',"r.use(requiere())"],
  ['src/routes/ayudas.mjs',"requiere('admin')"],
  ['src/routes/ayudas.mjs',"id=ANY($2::uuid[])"],
  ['src/migrations/011_guias_interactivas.sql','CREATE TABLE IF NOT EXISTS guia_configuracion'],
  ['src/migrations/011_guias_interactivas.sql','CREATE TABLE IF NOT EXISTS guia_preferencias'],
  ['public/js/app.js','iniciarAyudas()'],
  ['public/js/admin.js',"['ayudas', '❔ Ayudas guiadas']"],
  ['public/js/ayudas.js','abrirRecorrido(previsualizar=false)'],
  ['public/index.html','id="guia-abrir"']
];
for(const [path,frag] of archivos){
  const src=readFileSync(new URL('../'+path,import.meta.url),'utf8');
  assert.ok(src.includes(frag),'Integración faltante: '+path+' / '+frag);
}
console.log('✔ Reglas e integración estructural de ayudas correctas.');
