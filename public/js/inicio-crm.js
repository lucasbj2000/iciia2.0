/* IMPAR · Inicio de sesión con la estructura del CRM: saludo según la hora y botón de tema
   (el mismo tema que después usa el CRM). */
import { S, aplicarTema } from './core.js';
import { saludoHora } from './clima-animado.js';

export function iniciarInicioCRM() {
  const saludo = document.querySelector('#l-saludo span');
  if (saludo) saludo.textContent = saludoHora();
  const tema = document.getElementById('l-tema');
  if (tema) tema.onclick = () => {
    S.tema = S.tema === 'oscuro' ? 'claro' : 'oscuro';
    localStorage.setItem('iciia_tema', S.tema);
    aplicarTema();
  };
}
