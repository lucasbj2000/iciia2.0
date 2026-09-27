#!/usr/bin/env node
/** Verificación estática: sintaxis, imports y exports cruzados. */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const raiz = resolve(dirname(new URL(import.meta.url).pathname), '..');
let errores = 0;
const archivos = [];
(function walk(d) {
  for (const f of readdirSync(d)) {
    if (['node_modules', '.git', 'media', 'auth', 'logs'].includes(f)) continue;
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(mjs|js)$/.test(f)) archivos.push(p);
  }
})(raiz);

console.log(`\n· Verificando ${archivos.length} archivos\n`);

// 1. Sintaxis
for (const f of archivos) {
  try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); }
  catch (e) { console.error(`✖ Sintaxis en ${f.replace(raiz, '.')}\n  ${e.stderr}`); errores++; }
}
console.log('✔ Sintaxis correcta');

// 2. Imports internos resuelven a archivos existentes
for (const f of archivos) {
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(/(?:^|\s)(?:import|export)[^'"]*from\s+['"](\.[^'"]+)['"]/g)) {
    const destino = resolve(dirname(f), m[1]);
    try { statSync(destino); }
    catch (e) { console.error(`✖ Import roto en ${f.replace(raiz, '.')}: ${m[1]}`); errores++; }
  }
  for (const m of src.matchAll(/import\(\s*['"](\.[^'"]+)['"]\s*\)/g)) {
    const destino = resolve(dirname(f), m[1]);
    try { statSync(destino); }
    catch (e) { console.error(`✖ Import dinámico roto en ${f.replace(raiz, '.')}: ${m[1]}`); errores++; }
  }
}
console.log('✔ Imports internos resuelven');

// 3. Exports nombrados existen en el módulo destino
const exportsDe = f => {
  const src = readFileSync(f, 'utf8');
  const out = new Set();
  for (const m of src.matchAll(/export\s+(?:async\s+)?(?:function|const|let|class)\s+([\w$]+)/g)) out.add(m[1]);
  for (const m of src.matchAll(/export\s*\{([^}]+)\}/g))
    m[1].split(',').forEach(x => out.add(x.trim().split(/\s+as\s+/).pop().trim()));
  return out;
};
for (const f of archivos) {
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"](\.[^'"]+)['"]/g)) {
    const destino = resolve(dirname(f), m[2]);
    let ex;
    try { ex = exportsDe(destino); } catch (e) { continue; }
    for (const nombre of m[1].split(',')) {
      const n = nombre.trim().split(/\s+as\s+/)[0].trim();
      if (!n || n.startsWith('*')) continue;
      if (!ex.has(n)) { console.error(`✖ ${f.replace(raiz, '.')} importa «${n}» que ${m[2]} no exporta`); errores++; }
    }
  }
}
console.log('✔ Exports nombrados coinciden');

// 4. No hay secretos versionados
const gi = readFileSync(join(raiz, '.gitignore'), 'utf8');
for (const must of ['.env', 'auth/', 'media/', 'node_modules/']) {
  if (!gi.includes(must)) { console.error(`✖ .gitignore no ignora ${must}`); errores++; }
}
console.log('✔ .gitignore protege secretos');

console.log(errores ? `\n✖ ${errores} problema(s)\n` : '\n✔ Todo correcto\n');
process.exit(errores ? 1 : 0);
