/* IMPAR · Inicio de sesión clásico: año del pie y botón de tema
   (el mismo tema que después usa el CRM). */
import { S, aplicarTema } from './core.js';

export function iniciarInicioAcceso() {
  const anio = document.getElementById('l-anio');
  if (anio) anio.textContent = String(new Date().getFullYear());
  const tema = document.getElementById('l-tema');
  if (tema) tema.onclick = () => {
    S.tema = S.tema === 'oscuro' ? 'claro' : 'oscuro';
    localStorage.setItem('iciia_tema', S.tema);
    aplicarTema();
  };

  // Celular: con el teclado abierto el área visible se achica; se compacta la pantalla
  // y se lleva el campo y el botón «Ingresar» a la vista.
  const login = document.getElementById('login');
  const form = document.getElementById('form-login');
  const vv = window.visualViewport;
  const alto = () => Math.round(vv?.height || innerHeight);
  let base = alto();
  const ajustar = () => {
    const activo = form?.contains(document.activeElement) && document.activeElement.matches('input');
    if (!activo) base = Math.max(base, alto());
    const abierto = !!activo && matchMedia('(max-width: 900px)').matches && alto() < base * 0.8;
    if (abierto !== login.classList.contains('lc-teclado')) login.classList.toggle('lc-teclado', abierto);
    if (abierto) document.getElementById('l-btn')?.scrollIntoView({ block: 'end' });
  };
  let espera;
  const luego = () => { clearTimeout(espera); espera = setTimeout(ajustar, 200); };
  vv?.addEventListener('resize', luego);
  vv?.addEventListener('scroll', luego);
  addEventListener('resize', luego);
  form?.addEventListener('focusin', luego);
  form?.addEventListener('focusout', luego);
}
