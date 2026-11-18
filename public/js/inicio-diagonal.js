/* IMPAR · Inicio de sesión «corte diagonal de dos papeles».
   Todo el movimiento lo hace CSS con transformaciones (no hay bucle en JavaScript):
   corre solo mientras se ve el inicio y se detiene solo al entrar al CRM.
   Este módulo pone el saludo, el año y la clase que oculta los adornos del CRM detrás. */
import { saludoHora } from './clima-animado.js';

export function iniciarInicioDiagonal() {
  const login = document.getElementById('login');
  const ni = document.getElementById('ni');
  if (!login || !ni) return;
  const raiz = document.documentElement;

  const saludo = () => {
    const caja = document.getElementById('l-saludo');
    if (!caja) return;
    const h = new Date().getHours();
    caja.classList.toggle('noche', h < 6 || h >= 19);
    const txt = caja.querySelector('span');
    if (txt) txt.textContent = saludoHora();
  };
  const anio = document.getElementById('l-anio');
  if (anio) anio.textContent = String(new Date().getFullYear());

  let visible = null;
  const revisar = () => {
    const ahora = !login.classList.contains('hidden') && !raiz.classList.contains('sesion-verificando');
    if (ahora === visible) return;
    visible = ahora;
    // classList.toggle con fuerza escribe el atributo aunque no cambie: solo se llama si cambió.
    raiz.classList.toggle('en-acceso', ahora);
    if (ahora) {
      saludo();
      // Entrada de una sola vez cada vez que aparece el inicio.
      ni.classList.remove('entra'); void ni.offsetWidth; ni.classList.add('entra');
      setTimeout(() => ni.classList.remove('entra'), 1400);
    }
  };
  // En celular el papel verde mide lo mismo que el bloque del logo y la frase.
  const marca = ni.querySelector('.ni-marca');
  const medir = () => ni.style.setProperty('--ni-alto', marca.offsetHeight + 'px');
  if (window.ResizeObserver) new ResizeObserver(medir).observe(marca); else addEventListener('resize', medir);
  medir();
  // Celular con el teclado abierto: cabecera compacta y el campo activo siempre a la vista.
  // Solo se activa si el área visible realmente se achica (el teclado está abierto),
  // no por el foco automático que el CRM pone en «Usuario» al cargar.
  const form = document.getElementById('form-login');
  const vv = window.visualViewport;
  const altoVisible = () => Math.round(vv?.height || innerHeight);
  let base = altoVisible();
  const movil = () => matchMedia('(max-width: 900px)').matches;
  const escribiendo = () => form?.contains(document.activeElement) && document.activeElement.matches('input');
  const ajustar = () => {
    const alto = altoVisible();
    if (!escribiendo()) base = Math.max(base, alto);
    const tecladoAbierto = movil() && escribiendo() && alto < base * 0.8;
    if (tecladoAbierto !== ni.classList.contains('ni-escribiendo')) ni.classList.toggle('ni-escribiendo', tecladoAbierto);
    if (tecladoAbierto) document.activeElement.scrollIntoView({ block: 'center' });
  };
  let espera;
  const luego = () => { clearTimeout(espera); espera = setTimeout(ajustar, 180); };
  vv?.addEventListener('resize', luego);
  addEventListener('resize', luego);
  form?.addEventListener('focusin', luego);
  form?.addEventListener('focusout', luego);
  new MutationObserver(revisar).observe(login, { attributes: true, attributeFilter: ['class'] });
  new MutationObserver(revisar).observe(raiz, { attributes: true, attributeFilter: ['class'] });
  revisar();
}
