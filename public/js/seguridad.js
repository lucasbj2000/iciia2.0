/* IMPAR · Seguridad en el navegador: cambio obligatorio de contraseña, verificación en dos pasos y
   cierre de sesión en todos los dispositivos. Los códigos y contraseñas nunca se guardan. */
import { $, S, esc, post, toast, mejorarContrasenas, salir } from './core.js';

const REGLA = 'Mínimo 10 caracteres, con letras y números. Que no contenga tu usuario ni tu nombre.';
const guardarToken = t => { if (!t) return; S.token = t; try { localStorage.setItem('iciia_token', t); } catch (_) {} };

/** Pantalla que no se puede cerrar hasta elegir una contraseña nueva. Resuelve cuando se cambió. */
export function forzarCambioClave(actual = '') {
  if ($('#cambio-obligatorio')) return Promise.resolve();
  return new Promise(resolve => {
    const capa = document.createElement('div');
    capa.id = 'cambio-obligatorio'; capa.className = 'seg-capa';
    capa.innerHTML = `<form class="seg-card" role="dialog" aria-modal="true" aria-labelledby="seg-t">
      <h2 id="seg-t">Elegí una contraseña nueva</h2>
      <p class="sub">Por seguridad, tu contraseña actual no se puede seguir usando: ${actual ? 'es muy débil o la eligió otra persona' : 'la eligió otra persona o es muy débil'}. ${REGLA}</p>
      ${actual ? '' : '<div class="field"><label for="seg-a">Contraseña actual</label><input id="seg-a" type="password" autocomplete="current-password" required></div>'}
      <div class="field"><label for="seg-n">Contraseña nueva</label><input id="seg-n" type="password" autocomplete="new-password" required minlength="10"></div>
      <div class="field"><label for="seg-r">Repetí la contraseña nueva</label><input id="seg-r" type="password" autocomplete="new-password" required minlength="10"></div>
      <div class="err" id="seg-err" role="alert"></div>
      <button class="btn block" type="submit">Guardar contraseña</button>
      <button class="btn ghost block" type="button" id="seg-salir">Salir</button>
    </form>`;
    document.body.append(capa);
    mejorarContrasenas(capa);
    setTimeout(() => (capa.querySelector('#seg-a') || capa.querySelector('#seg-n')).focus(), 50);
    capa.querySelector('#seg-salir').onclick = () => { capa.remove(); salir(); };
    capa.querySelector('form').onsubmit = async e => {
      e.preventDefault();
      const nueva = capa.querySelector('#seg-n').value, err = capa.querySelector('#seg-err');
      if (nueva !== capa.querySelector('#seg-r').value) { err.textContent = 'Las dos contraseñas nuevas no coinciden.'; return; }
      const btn = capa.querySelector('button[type=submit]'); btn.disabled = true; err.textContent = '';
      try {
        const r = await post('/perfil/password', { actual: actual || capa.querySelector('#seg-a').value, nueva });
        guardarToken(r.token);
        if (S.usuario) S.usuario.debeCambiarClave = false;
        capa.remove(); toast('Contraseña actualizada. Se cerraron tus otras sesiones.', 'ok', 'Seguridad');
        resolve();
      } catch (ex) { err.textContent = ex.message; btn.disabled = false; }
    };
  });
}

/** Paso del código de dos pasos dentro de la tarjeta de ingreso. Devuelve la respuesta de /login/2fa. */
export function pedirCodigoLogin(desafio) {
  const form = $('#form-login');
  return new Promise((resolve, reject) => {
    form.classList.add('con-codigo');
    let caja = $('#l-2fa-caja');
    if (!caja) {
      caja = document.createElement('div');
      caja.id = 'l-2fa-caja'; caja.className = 'field';
      caja.innerHTML = `<label for="l-2fa">Código de verificación</label>
        <input id="l-2fa" inputmode="numeric" autocomplete="one-time-code" maxlength="7" placeholder="000000" pattern="[0-9 ]*">
        <small class="sub">Abrí tu app autenticadora y escribí el código de 6 números de IMPAR CRM.</small>`;
      $('#l-err').before(caja);
    }
    const input = $('#l-2fa'); input.value = ''; setTimeout(() => input.focus(), 30);
    const anterior = form.onsubmit;
    form.onsubmit = async e => {
      e.preventDefault();
      const btn = $('#l-btn'); btn.disabled = true; $('#l-err').textContent = '';
      try {
        const r = await post('/login/2fa', { desafio, codigo: input.value });
        form.onsubmit = anterior; form.classList.remove('con-codigo'); caja.remove();
        resolve(r);
      } catch (ex) {
        if (ex.data?.reiniciar) { form.onsubmit = anterior; form.classList.remove('con-codigo'); caja.remove(); reject(ex); return; }
        $('#l-err').textContent = ex.message; input.select();
      } finally { btn.disabled = false; }
    };
  });
}

/** Tarjeta de seguridad en «Mi perfil». */
export function tarjetaSeguridad() {
  const activo = !!S.usuario?.dosPasos;
  return `<div class="card-box seg-perfil" id="seg-perfil"><h3>Seguridad de tu cuenta</h3>
    <div class="seg-fila"><div><b>Verificación en dos pasos</b>
      <p class="sub">${activo ? 'Activa: además de la contraseña, al ingresar se pide un código de tu celular.' : 'Sumá un código de tu celular al ingreso: aunque alguien sepa tu contraseña, no puede entrar.'}</p></div>
      <button class="btn sm ${activo ? 'ghost' : ''}" id="seg-2fa" type="button">${activo ? 'Desactivar' : 'Activar'}</button></div>
    <div class="seg-fila"><div><b>Sesiones abiertas</b>
      <p class="sub">Si perdiste el celular o entraste desde una computadora ajena, cerrá todas las sesiones.</p></div>
      <button class="btn sm ghost" id="seg-todas" type="button">Cerrar en todos los dispositivos</button></div>
  </div>`;
}
export function activarTarjetaSeguridad() {
  const b = $('#seg-2fa'); if (!b) return;
  b.onclick = () => S.usuario?.dosPasos ? desactivar2fa() : activar2fa();
  $('#seg-todas').onclick = async () => {
    if (!confirm('¿Cerrar la sesión en todos los dispositivos, incluido este?')) return;
    try { await post('/sesion/cerrar-todas', {}); toast('Listo: se cerraron todas las sesiones.', 'ok', 'Seguridad'); salir(); }
    catch (e) { toast(e.message, 'bad'); }
  };
}
async function activar2fa() {
  let datos;
  try { datos = await post('/perfil/2fa/preparar', {}); } catch (e) { return toast(e.message, 'bad'); }
  const m = await import('./core.js');
  m.modal(`<div class="modal-h"><h3>Activar la verificación en dos pasos</h3><button class="x" data-close type="button" aria-label="Cerrar">✕</button></div>
    <div class="modal-b"><ol class="seg-pasos">
      <li>Instalá en tu celular <b>Google Authenticator</b> o <b>Microsoft Authenticator</b>.</li>
      <li><span>En la app, tocá <b>+</b> y escaneá este código:</span><div class="seg-qr">${datos.qr}</div>
        <small class="sub">¿No podés escanear? Ingresá esta clave a mano:<br><code>${esc(datos.secreto)}</code></small></li>
      <li>Escribí el código de 6 números que muestra la app:
        <div class="field"><input id="seg-cod" inputmode="numeric" autocomplete="one-time-code" maxlength="7" placeholder="000000"></div></li>
    </ol>
    <div class="err" id="seg-err2" role="alert"></div></div>
    <div class="modal-f"><button class="btn ghost" data-close type="button">Cancelar</button><button class="btn" id="seg-ok" type="button">Activar</button></div>`);
  document.querySelectorAll('#modals [data-close]').forEach(b => b.onclick = () => m.cerrar());
  $('#seg-ok').onclick = async () => {
    try {
      const r = await post('/perfil/2fa/activar', { codigo: $('#seg-cod').value });
      guardarToken(r.token); S.usuario.dosPasos = true; m.cerrar();
      toast('Verificación en dos pasos activada. Desde ahora se pide el código al ingresar.', 'ok', 'Seguridad');
      $('#seg-perfil').outerHTML = tarjetaSeguridad(); activarTarjetaSeguridad();
    } catch (e) { $('#seg-err2').textContent = e.message; }
  };
}
async function desactivar2fa() {
  const m = await import('./core.js');
  m.modal(`<div class="modal-h"><h3>Desactivar la verificación en dos pasos</h3><button class="x" data-close type="button" aria-label="Cerrar">✕</button></div>
    <div class="modal-b"><p class="sub">Tu cuenta va a quedar protegida solo con la contraseña.</p>
    <div class="field"><label for="seg-c">Tu contraseña</label><input id="seg-c" type="password" autocomplete="current-password"></div>
    <div class="field"><label for="seg-cod2">Código de la app</label><input id="seg-cod2" inputmode="numeric" maxlength="7" placeholder="000000"></div>
    <div class="err" id="seg-err3" role="alert"></div></div>
    <div class="modal-f"><button class="btn ghost" data-close type="button">Cancelar</button><button class="btn" id="seg-no" type="button">Desactivar</button></div>`);
  document.querySelectorAll('#modals [data-close]').forEach(b => b.onclick = () => m.cerrar());
  $('#seg-no').onclick = async () => {
    try {
      const r = await post('/perfil/2fa/desactivar', { clave: $('#seg-c').value, codigo: $('#seg-cod2').value });
      guardarToken(r.token); S.usuario.dosPasos = false; m.cerrar();
      toast('Verificación en dos pasos desactivada.', 'warn', 'Seguridad');
      $('#seg-perfil').outerHTML = tarjetaSeguridad(); activarTarjetaSeguridad();
    } catch (e) { $('#seg-err3').textContent = e.message; }
  };
}
