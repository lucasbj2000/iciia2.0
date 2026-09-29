/**
 * Express 4 no captura errores de funciones async: la petición queda colgada.
 * Este ajuste hace que cualquier promesa rechazada llegue al manejador de errores.
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
try {
  const Layer = require('express/lib/router/layer.js');
  Layer.prototype.handle_request = function handle(req, res, next) {
    const fn = this.handle;
    if (fn.length > 3) return next();
    try {
      const r = fn(req, res, next);
      if (r && typeof r.catch === 'function') r.catch(next);
    } catch (err) { next(err); }
  };
} catch (e) {
  console.warn('⚠ No se pudo activar la captura de errores async:', e.message);
}
