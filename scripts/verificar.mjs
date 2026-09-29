#!/usr/bin/env node
/** Verificación estática: sintaxis, imports y exports cruzados. */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative, sep } from 'node:path';
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

const rel = f => relative(raiz, f).split(sep).join('/');

/*
 * Los aplicar*.mjs y diag.mjs de la raíz son utilidades históricas de
 * mantenimiento. Contienen fragmentos de JavaScript dentro de strings para
 * aplicar parches y, por lo tanto, una búsqueda por regex puede confundir esos
 * textos con imports ejecutables.
 *
 * La sintaxis se valida en TODOS los .js/.mjs. La resolución cruzada de imports
 * se limita al código que realmente forma parte de la aplicación y sus scripts
 * operativos.
 */
const esCodigoEjecutable = f => {
  const r = rel(f);
  return r.startsWith('src/') || r.startsWith('public/js/') || r.startsWith('scripts/');
};

const ejecutables = archivos.filter(esCodigoEjecutable);

console.log(`\n· Verificando ${archivos.length} archivos (${ejecutables.length} con dependencias ejecutables)\n`);

// 1. Sintaxis: se comprueba todo, incluidos los scripts históricos.
{
  const antes = errores;
  for (const f of archivos) {
    try {
      execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
    } catch (e) {
      console.error(`✖ Sintaxis en ./${rel(f)}\n  ${e.stderr}`);
      errores++;
    }
  }
  if (errores === antes) console.log('✔ Sintaxis correcta');
  else console.log(`✖ Sintaxis: ${errores - antes} problema(s)`);
}

// 2. Imports internos del código ejecutable resuelven a archivos existentes.
{
  const antes = errores;
  for (const f of ejecutables) {
    const src = readFileSync(f, 'utf8');

    for (const m of src.matchAll(/(?:^|\s)(?:import|export)[^'"]*from\s+['"](\.[^'"]+)['"]/g)) {
      const destino = resolve(dirname(f), m[1]);
      try {
        statSync(destino);
      } catch {
        console.error(`✖ Import roto en ./${rel(f)}: ${m[1]}`);
        errores++;
      }
    }

    for (const m of src.matchAll(/import\(\s*['"](\.[^'"]+)['"]\s*\)/g)) {
      const destino = resolve(dirname(f), m[1]);
      try {
        statSync(destino);
      } catch {
        console.error(`✖ Import dinámico roto en ./${rel(f)}: ${m[1]}`);
        errores++;
      }
    }
  }
  if (errores === antes) console.log('✔ Imports internos resuelven');
  else console.log(`✖ Imports internos: ${errores - antes} problema(s)`);
}

// 3. Exports nombrados existen en el módulo destino.
const exportsDe = f => {
  const src = readFileSync(f, 'utf8');
  const out = new Set();

  for (const m of src.matchAll(/export\s+(?:async\s+)?(?:function|const|let|class)\s+([\w$]+)/g)) {
    out.add(m[1]);
  }

  for (const m of src.matchAll(/export\s*\{([^}]+)\}/g)) {
    m[1].split(',').forEach(x => out.add(x.trim().split(/\s+as\s+/).pop().trim()));
  }

  return out;
};

{
  const antes = errores;
  for (const f of ejecutables) {
    const src = readFileSync(f, 'utf8');

    for (const m of src.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"](\.[^'"]+)['"]/g)) {
      const destino = resolve(dirname(f), m[2]);
      let ex;

      try {
        ex = exportsDe(destino);
      } catch {
        continue;
      }

      for (const nombre of m[1].split(',')) {
        const n = nombre.trim().split(/\s+as\s+/)[0].trim();
        if (!n || n.startsWith('*')) continue;

        if (!ex.has(n)) {
          console.error(`✖ ./${rel(f)} importa «${n}» que ${m[2]} no exporta`);
          errores++;
        }
      }
    }
  }
  if (errores === antes) console.log('✔ Exports nombrados coinciden');
  else console.log(`✖ Exports nombrados: ${errores - antes} problema(s)`);
}

// 4. No hay secretos versionados.
{
  const antes = errores;
  const gi = readFileSync(join(raiz, '.gitignore'), 'utf8');

  for (const must of ['.env', 'auth/', 'media/', 'node_modules/']) {
    if (!gi.includes(must)) {
      console.error(`✖ .gitignore no ignora ${must}`);
      errores++;
    }
  }

  if (errores === antes) console.log('✔ .gitignore protege secretos');
  else console.log(`✖ Protección de secretos: ${errores - antes} problema(s)`);
}

console.log(errores ? `\n✖ ${errores} problema(s)\n` : '\n✔ Todo correcto\n');
process.exit(errores ? 1 : 0);
