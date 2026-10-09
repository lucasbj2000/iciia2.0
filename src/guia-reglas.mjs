/** Reglas puras de visibilidad de guías: útiles también en pruebas sin base de datos. */
export function resolverGuia(config={},preferencia={}) {
  const modo=preferencia.modo||'heredar';
  const habilitado=modo==='mostrar'||(modo!=='ocultar' && !!config.general);
  return {
    habilitado,
    mini_ayudas: habilitado && config.mini_ayudas !== false,
    bienvenida: habilitado && config.bienvenida !== false,
    recorrido_visto: !!preferencia.recorrido_visto
  };
}
