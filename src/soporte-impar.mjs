/** IMPAR · Reglas del soporte interno (sin base de datos, para poder probarlas).
 *
 * Estados:  gerencia → administracion → aprobada → resuelta
 *                 ↘ rechazada        ↘ rechazada
 * Una consulta aprobada por administración puede responderse y resolverse en el mismo paso.
 */
export const TIPOS = {
  consulta: 'Consulta',
  falla: 'Falla',
  mejora: 'Solicitud de mejora'
};
export const MODULOS = {
  negociaciones: 'Negociaciones', contactos: 'Contactos', chat: 'Conversaciones y WhatsApp',
  comunicacion: 'Comunicación interna', calendario: 'Calendario', reportes: 'Reportes',
  acceso: 'Acceso e inicio de sesión', movil: 'Uso en el celular', otro: 'Otro'
};
export const IMPACTOS = { bajo: 'Puedo seguir trabajando', medio: 'Me demora el trabajo', alto: 'Me impide trabajar' };
export const ESTADOS = {
  gerencia: 'Esperando aprobación de gerencia',
  administracion: 'Esperando confirmación de administración',
  aprobada: 'Aprobada, en preparación',
  resuelta: 'Resuelta',
  rechazada: 'No aprobada'
};
export const ABIERTOS = new Set(['gerencia', 'administracion', 'aprobada']);

const limpio = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const texto = (v, max) => String(v ?? '').replace(/\r\n/g, '\n').trim().slice(0, max);

/** Valida y normaliza una nueva solicitud. Devuelve { error } o { datos }. */
export function validarSolicitud(b = {}) {
  const tipo = String(b.tipo || '');
  if (!TIPOS[tipo]) return { error: 'Elegí si es una consulta, una falla o una solicitud de mejora.' };
  const titulo = limpio(b.titulo, 140);
  if (titulo.length < 4) return { error: 'Escribí un título corto que resuma el pedido.' };
  const descripcion = texto(b.descripcion, 4000);
  if (descripcion.length < 10) return { error: 'Contá con un poco más de detalle qué necesitás o qué pasó.' };
  const modulo = MODULOS[b.modulo] ? b.modulo : 'otro';
  const impacto = IMPACTOS[b.impacto] ? b.impacto : 'medio';
  const c = b.contexto && typeof b.contexto === 'object' ? b.contexto : {};
  // Datos técnicos que ayudan a reproducir una falla; nada de contenido de clientes.
  const contexto = {
    vista: limpio(c.vista, 30), pantalla: limpio(c.pantalla, 20),
    navegador: limpio(c.navegador, 200), version: limpio(c.version, 80)
  };
  return { datos: { tipo, titulo, descripcion, modulo, impacto, contexto } };
}

/** Estado inicial: si no hay otro gerente aprobador disponible, pasa directo a administración. */
export function estadoInicial({ aprobadores = [], autorId, autorRol }) {
  if (autorRol === 'admin') return 'administracion';
  const otros = aprobadores.filter(id => id !== autorId);
  return otros.length ? 'gerencia' : 'administracion';
}

/** Roles de un usuario frente al soporte. */
export function rolesSoporte(user, cfg = {}) {
  const esAdmin = user.rol === 'admin';
  const esAprobador = !esAdmin && user.rol === 'gerente' && (cfg.aprobadores || []).includes(user.id);
  const esObservador = (cfg.observadores || []).includes(user.id);
  return { esAdmin, esAprobador, esObservador, veTodo: esAdmin || esAprobador || esObservador };
}

export function puedeVer(user, sol, cfg) {
  return sol.autor_id === user.id || rolesSoporte(user, cfg).veTodo;
}

/** Acciones disponibles para un usuario sobre una solicitud. */
export function accionesDisponibles(user, sol, cfg) {
  const r = rolesSoporte(user, cfg);
  const propia = sol.autor_id === user.id;
  const a = [];
  // El admin también puede destrabar la etapa de gerencia (por ejemplo, si quitó a un aprobador).
  if (sol.estado === 'gerencia' && ((r.esAprobador && !propia) || r.esAdmin)) a.push('aprobar', 'rechazar');
  if (sol.estado === 'administracion' && r.esAdmin) {
    a.push('confirmar', 'rechazar');
    if (sol.tipo === 'consulta') a.push('resolver');
  }
  if (sol.estado === 'aprobada' && r.esAdmin) a.push('resolver');
  return a;
}

const TRANSICION = {
  aprobar: { de: 'gerencia', a: 'administracion', evento: 'aprobada_gerencia' },
  confirmar: { de: 'administracion', a: 'aprobada', evento: 'confirmada' },
  resolver: { de: ['administracion', 'aprobada'], a: 'resuelta', evento: 'resuelta' },
  rechazar: { de: ['gerencia', 'administracion'], a: 'rechazada', evento: 'rechazada' }
};

/** Decide el cambio de estado. Devuelve { error } o { estado, evento, nota }. */
export function decidir(user, sol, cfg, accion, nota) {
  const t = TRANSICION[accion];
  if (!t) return { error: 'Acción no válida.' };
  if (!accionesDisponibles(user, sol, cfg).includes(accion))
    return { error: 'No podés realizar esta acción sobre la solicitud en su estado actual.' };
  const n = texto(nota, 2000);
  if (accion === 'rechazar' && n.length < 5) return { error: 'Explicá brevemente por qué no se aprueba.' };
  if (accion === 'resolver' && sol.tipo === 'consulta' && n.length < 5) return { error: 'Escribí la respuesta a la consulta.' };
  return { estado: t.a, evento: t.evento, nota: n, etapa: sol.estado };
}

/** Resumen para la mini reportería, a partir de filas de solicitudes. */
export function resumir(filas, ahora = Date.now()) {
  const horas = (a, b) => (new Date(b) - new Date(a)) / 3600000;
  const prom = xs => xs.length ? Math.round(xs.reduce((s, x) => s + x, 0) / xs.length * 10) / 10 : null;
  const cuenta = (k, base) => filas.reduce((m, f) => { m[f[k]] = (m[f[k]] || 0) + 1; return m; }, { ...base });
  const cero = o => Object.fromEntries(Object.keys(o).map(k => [k, 0]));
  const abiertas = filas.filter(f => ABIERTOS.has(f.estado));
  const fallasPorModulo = filas.filter(f => f.tipo === 'falla')
    .reduce((m, f) => { m[f.modulo] = (m[f.modulo] || 0) + 1; return m; }, {});
  return {
    total: filas.length,
    abiertas: abiertas.length,
    fallasAbiertasAlto: abiertas.filter(f => f.tipo === 'falla' && f.impacto === 'alto').length,
    porTipo: cuenta('tipo', cero(TIPOS)),
    porEstado: cuenta('estado', cero(ESTADOS)),
    fallasPorModulo: Object.entries(fallasPorModulo).sort((a, b) => b[1] - a[1])
      .map(([modulo, n]) => ({ modulo, nombre: MODULOS[modulo] || modulo, n })),
    horasGerencia: prom(filas.filter(f => f.gerente_ts).map(f => horas(f.creado, f.gerente_ts))),
    horasResolucion: prom(filas.filter(f => f.resuelta_ts).map(f => horas(f.creado, f.resuelta_ts))),
    masAntigua: abiertas.length ? Math.round(Math.max(...abiertas.map(f => horas(f.creado, ahora))) * 10) / 10 : 0
  };
}
