/* IMPAR · Seguridad en el navegador: cerrar la sesión en todos los dispositivos. */
import { $, post, toast, salir } from './core.js';

/** Tarjeta de seguridad en «Mi perfil». */
export function tarjetaSeguridad() {
  return `<div class="card-box seg-perfil" id="seg-perfil"><h3>Sesiones abiertas</h3>
    <div class="seg-fila"><div><p class="sub">Si perdiste el celular o entraste desde una computadora ajena, cerrá todas las sesiones. Cambiar tu contraseña también las cierra.</p></div>
      <button class="btn sm ghost" id="seg-todas" type="button">Cerrar en todos los dispositivos</button></div>
  </div>`;
}
export function activarTarjetaSeguridad() {
  const b = $('#seg-todas'); if (!b) return;
  b.onclick = async () => {
    if (!confirm('¿Cerrar la sesión en todos los dispositivos, incluido este?')) return;
    try { await post('/sesion/cerrar-todas', {}); toast('Listo: se cerraron todas las sesiones.', 'ok', 'Seguridad'); salir(); }
    catch (e) { toast(e.message, 'bad'); }
  };
}
