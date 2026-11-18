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
}
