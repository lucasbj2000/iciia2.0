/* IMPAR · Inicio de sesión ilustrado (escritorio de IMPAR con el CRM).
   El movimiento lo hace CSS con transformaciones; aquí solo:
   - la clase que oculta los adornos del CRM mientras se ve el acceso;
   - en celular, con el teclado abierto, ocultar la ilustración para ver el formulario entero. */
export function iniciarInicioIlustrado() {
  const login = document.getElementById('login');
  const ri = document.getElementById('ri');
  const form = document.getElementById('form-login');
  if (!login || !ri || !form) return;
  const raiz = document.documentElement;

  let visible = null;
  const revisar = () => {
    const ahora = !login.classList.contains('hidden') && !raiz.classList.contains('sesion-verificando');
    if (ahora === visible) return;   // solo escribe la clase si cambió (evita bucles del observador)
    visible = ahora;
    raiz.classList.toggle('en-acceso', ahora);
    if (ahora) { ri.classList.remove('entra'); void ri.offsetWidth; ri.classList.add('entra'); }
  };
  new MutationObserver(revisar).observe(login, { attributes: true, attributeFilter: ['class'] });
  new MutationObserver(revisar).observe(raiz, { attributes: true, attributeFilter: ['class'] });
  revisar();

  // Teclado del celular: solo si el área visible realmente se achica (no por el foco automático al cargar).
  const vv = window.visualViewport;
  const alto = () => Math.round(vv?.height || innerHeight);
  let base = alto();
  const ajustar = () => {
    const activo = form.contains(document.activeElement) && document.activeElement.matches('input');
    if (!activo) base = Math.max(base, alto());
    const abierto = matchMedia('(max-width: 860px)').matches && activo && alto() < base * 0.8;
    if (abierto !== ri.classList.contains('ri-escribiendo')) ri.classList.toggle('ri-escribiendo', abierto);
    if (abierto) document.activeElement.scrollIntoView({ block: 'center' });
  };
  let espera;
  const luego = () => { clearTimeout(espera); espera = setTimeout(ajustar, 180); };
  vv?.addEventListener('resize', luego);
  addEventListener('resize', luego);
  form.addEventListener('focusin', luego);
  form.addEventListener('focusout', luego);
}
