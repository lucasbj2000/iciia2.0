#!/usr/bin/env node
/**
 * Parche 2 · iciia2.0
 *  - Teléfonos paraguayos unificados (0976… = 595976…) y soporte de WhatsApp LID
 *  - Duplicados imposibles en Nuevo / Contactado / Espera (bloqueo en la base)
 *  - Texto legible en los campos de mensaje
 *  - Edición completa para el admin (empleados, jefes, clientes, negociaciones)
 *  - Rol «soporte» y visibilidad: admin/gerente/soporte ven todo · jefe su equipo · agente lo suyo
 *
 * Uso (desde /opt/iciia-crm):  node aplicar2.mjs && pm2 restart iciia-crm
 */
import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';

const R = process.cwd();
let hechos = 0, ya = 0, errores = 0;
const ok = m => { console.log('  ✔ ' + m); hechos++; };
const skip = m => { console.log('  · ' + m); ya++; };
const mal = m => { console.error('  ✖ ' + m); errores++; };

function editar(rel, marca, fn) {
  const p = join(R, rel);
  if (!existsSync(p)) return mal(`no existe ${rel}`);
  const antes = readFileSync(p, 'utf8');
  if (marca && antes.includes(marca)) return skip(`${rel}: ya aplicado`);
  const despues = fn(antes);
  if (despues === null) return;
  if (despues === antes) return mal(`${rel}: no se encontró el código a modificar`);
  if (!existsSync(p + '.orig2')) copyFileSync(p, p + '.orig2');
  writeFileSync(p, despues, 'utf8');
  ok(rel);
}
function reemplazar(s, viejo, nuevo, etiqueta) {
  if (!s.includes(viejo)) { mal(`no se encontró: ${etiqueta}`); return s; }
  return s.split(viejo).join(nuevo);
}

console.log('\n══ Parche 2 · iciia2.0 ══\n');

for (const f of ['src/migrations/002_duplicados_y_roles.sql', 'src/async-errors.mjs',
                 'src/routes/edicion.mjs', 'public/js/edicion.js']) {
  if (!existsSync(join(R, f))) { mal(`Falta copiar ${f} antes de correr el parche`); }
}
if (errores) { console.error('\nCopiá los archivos nuevos y volvé a correr.\n'); process.exit(1); }

/* 1. Teléfono normalizado */
console.log('1. Teléfonos paraguayos');
editar('src/db.mjs', 'TELNORM_PY', s => reemplazar(s,
  "export const telNorm = t => String(t || '').replace(/\\D/g, '').slice(-8);",
  `/* TELNORM_PY — 0976586543, 595976586543, +595 976 586 543 y 00595976586543 → 976586543 */
export const telNorm = t => {
  let d = String(t || '').replace(/\\D/g, '').replace(/^0+/, '');
  if (d.startsWith('595')) d = d.slice(3);
  return d.replace(/^0+/, '');
};`, 'telNorm'));

/* 2. WhatsApp LID */
console.log('\n2. WhatsApp con identificador LID');
editar('src/channels/baileys.mjs', 'SOPORTE_LID', s => {
  s = reemplazar(s,
    `  if (jid.endsWith('@g.us') || jid === 'status@broadcast' || jid.endsWith('@newsletter')) return;`,
    `  if (jid.endsWith('@g.us') || jid === 'status@broadcast' || jid.endsWith('@newsletter')) return;
  /* SOPORTE_LID — WhatsApp puede ocultar el número detrás de un identificador @lid */
  let remitenteNum = jid.split('@')[0];
  if (jid.endsWith('@lid')) {
    const alt = m.key.senderPn || m.key.remoteJidAlt || m.key.participantPn || '';
    remitenteNum = alt ? alt.split('@')[0] : jid;
  }`, 'filtro de remitente');
  s = reemplazar(s, `m.key.id, jid.split('@')[0], m.pushName`, `m.key.id, remitenteNum, m.pushName`, 'insert inbox');
  s = reemplazar(s,
    "  const jid = `${num}@s.whatsapp.net`;",
    "  const jid = String(destino).includes('@') ? String(destino) : `${num}@s.whatsapp.net`;", 'jid de envío');
  return s;
});
editar('src/core.mjs', 'TEL_SIN_LID', s => {
  s = reemplazar(s, `tel: origen === 'whatsapp' ? remitente : null,`,
    `tel: (origen === 'whatsapp' && !String(remitente).includes('@')) ? remitente : null, // TEL_SIN_LID`, 'búsqueda');
  s = reemplazar(s, `tel: origen === 'whatsapp' ? remitente : '',`,
    `tel: (origen === 'whatsapp' && !String(remitente).includes('@')) ? remitente : '',`, 'alta');
  /* 3. Anti duplicado siempre activo, en las tres etapas aunque se desmarquen */
  s = reemplazar(s, `const abierta = empresa.flags?.antiDuplicado ? await negActivaDeContacto(empresa, contacto.id) : null;`,
    `const abierta = await negActivaDeContacto(empresa, contacto.id);`, 'ingreso');
  s = reemplazar(s, `[empresa.id, contactoId, etapasActivas(empresa), excluir]`,
    `[empresa.id, contactoId, [...new Set([...etapasActivas(empresa), 'nuevo', 'contactado', 'espera'])], excluir]`, 'negActivaDeContacto');
  s = reemplazar(s, `[empresa.id, t, etapasActivas(empresa), excluir]`,
    `[empresa.id, t, [...new Set([...etapasActivas(empresa), 'nuevo', 'contactado', 'espera'])], excluir]`, 'negActivaPorTel');
  return s;
});

console.log('\n3. Duplicados bloqueados');
editar('src/routes/negociaciones.mjs', 'ANTIDUP_FORZADO', s =>
  reemplazar(s, 'emp.flags?.antiDuplicado', 'true /* ANTIDUP_FORZADO */', 'chequeos'));
editar('src/routes/contactos.mjs', 'ANTIDUP_FORZADO', s => {
  s = reemplazar(s, 'emp.flags?.antiDuplicado', 'true /* ANTIDUP_FORZADO */', 'alta');
  return reemplazar(s, 'req.empresa.flags?.antiDuplicado', 'true', 'chequeo en vivo');
});

/* 4. Servidor: errores async, duplicado → 409, rutas nuevas */
console.log('\n4. Servidor');
editar('src/server.mjs', 'ERRORES_409', s => {
  s = reemplazar(s, `import 'dotenv/config';`, `import 'dotenv/config';\nimport './async-errors.mjs';`, 'import');
  s = reemplazar(s, `import rVarios from './routes/varios.mjs';`,
    `import rVarios from './routes/varios.mjs';\nimport rEdicion from './routes/edicion.mjs';`, 'import rutas');
  s = reemplazar(s, `app.use('/api', rVarios);`, `app.use('/api/edicion', rEdicion);\napp.use('/api', rVarios);`, 'registro');
  s = reemplazar(s,
    `app.use((err, _req, res, _next) => {
  console.error('[error]', err);
  res.status(500).json({ error: 'error interno del servidor' });
});`,
    `app.use((err, _req, res, _next) => {   // ERRORES_409
  if (err && err.code === '23505') {
    const msg = /tel/.test(err.constraint || '')
      ? 'Ya existe un cliente con ese número de teléfono.'
      : 'Ese cliente ya tiene una negociación abierta. Buscala en el tablero.';
    return res.status(409).json({ error: 'duplicado', mensaje: msg });
  }
  console.error('[error]', err);
  res.status(500).json({ error: 'error interno del servidor' });
});`, 'manejador de errores');
  return s;
});

/* 5. Roles y visibilidad */
console.log('\n5. Roles y visibilidad');
editar('src/auth.mjs', 'ALCANCE_V2', s => {
  const nuevo = `/* ALCANCE_V2
   admin, gerente y soporte → todas las negociaciones
   jefe  → las suyas y las de los agentes a su cargo
   agente → solo las suyas */
export async function alcanceSQL(user, empresaId, alias = 'n', desde = 2) {
  if (['admin', 'gerente', 'soporte'].includes(user.rol)) return { where: '', params: [] };
  if (user.rol === 'jefe') {
    const { rows } = await q('SELECT id FROM usuarios WHERE empresa_id=$1 AND (equipo=$2 OR id=$3)',
      [empresaId, user.usuario, user.id]);
    return { where: \` AND \${alias}.agente_id = ANY($\${desde}::uuid[])\`, params: [rows.map(r => r.id)] };
  }
  return { where: \` AND \${alias}.agente_id = $\${desde}\`, params: [user.id] };
}
`;
  const i = s.indexOf('export async function alcanceSQL');
  if (i < 0) { mal('no se encontró alcanceSQL'); return s; }
  return s.slice(0, i) + nuevo;
});
editar('public/js/core.js', 'ROL_SOPORTE', s => {
  s = reemplazar(s, `export const ROLES = ['gerente', 'jefe', 'agente'];`,
    `export const ROLES = ['gerente', 'soporte', 'jefe', 'agente']; // ROL_SOPORTE`, 'ROLES');
  return reemplazar(s, `['admin', 'gerente', 'jefe'].includes(S.usuario?.rol)`,
    `['admin', 'gerente', 'soporte', 'jefe'].includes(S.usuario?.rol)`, 'esMando');
});
editar('public/js/modulos.js', 'soporte: \'Todas', s =>
  reemplazar(s, `gerente: 'Toda la empresa', jefe:`, `gerente: 'Toda la empresa', soporte: 'Todas las áreas', jefe:`, 'alcance en reportes'));

/* 6. Pestaña de edición */
console.log('\n6. Edición para el administrador');
editar('public/js/admin.js', 'aEdicion', s => {
  s = reemplazar(s, `['usuarios', 'Usuarios'],`, `['usuarios', 'Usuarios'], ['edicion', '✏ Editar datos'],`, 'pestaña');
  s = s.replace(/audit: aAudit(, datos: aDatos)? \}\[TADM\]/, m => m.replace(' }[TADM]', ', edicion: aEdicion }[TADM]'));
  if (!s.includes('edicion: aEdicion')) mal('no se encontró el mapa de pestañas');
  return reemplazar(s, `const AB = () => $('#adm-body');`,
    `const AB = () => $('#adm-body');\nasync function aEdicion() { const m = await import('./edicion.js'); await m.vistaEdicion(); }`, 'función');
});

/* 7. Texto invisible en los campos */
console.log('\n7. Legibilidad de los campos de texto');
editar('public/styles.css', 'FIX_CAMPOS_TEXTO', s => s + `

/* ===== FIX_CAMPOS_TEXTO =====
   Los campos fuera de .field quedaban con fondo blanco y letra blanca. */
input:not([type=checkbox]):not([type=radio]):not([type=color]):not([type=file]):not([type=range]),
select, textarea {
  background-color: var(--surface2);
  color: var(--txt);
  -webkit-text-fill-color: var(--txt);
  caret-color: var(--brand);
  border: 1px solid var(--line);
  border-radius: 10px;
}
.row > input:not([type=checkbox]), .ci-f input, #msg, #remsg {
  padding: 11px 13px; min-height: 42px; outline: none; transition: .2s var(--ease);
}
.row > input:focus, .ci-f input:focus, #msg:focus, #remsg:focus {
  border-color: var(--brand); box-shadow: 0 0 0 3px rgba(255,122,0,.16);
}
::placeholder { color: var(--muted); opacity: .85; -webkit-text-fill-color: var(--muted); }
select option { background: var(--surface); color: var(--txt); }
input:-webkit-autofill, input:-webkit-autofill:focus {
  -webkit-text-fill-color: var(--txt);
  -webkit-box-shadow: 0 0 0 1000px var(--surface2) inset;
  transition: background-color 9999s;
}
input:disabled { opacity: .6; }
`);

console.log(`\n${'─'.repeat(44)}`);
console.log(`  ${hechos} archivo(s) modificados · ${ya} ya estaban · ${errores} error(es)`);
console.log(`${'─'.repeat(44)}`);
if (errores) {
  console.error('\n✖ Hubo errores. No reinicies todavía: pegá esta salida para revisarla.\n');
  process.exit(1);
}
console.log('\n✔ Listo. Ahora:  pm2 restart iciia-crm');
console.log('  Al arrancar se aplica la migración que fusiona los duplicados existentes.');
console.log('  Copias de seguridad de cada archivo: *.orig2\n');
