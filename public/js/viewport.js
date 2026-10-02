// Usa el área visible cuando aparece el teclado; nunca fuerza el scroll de la página.
export function iniciarViewport() {
  let frame;
  const actualizar = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = null;
      const viewport = window.visualViewport;
      if (viewport && Math.abs(viewport.scale - 1) > 0.01) return;
      const alto = Math.round(viewport?.height || window.innerHeight);
      document.documentElement.classList.toggle('crm-viewport-compact', alto < 450);
      const arriba = Math.round(viewport?.offsetTop || 0);
      document.documentElement.style.setProperty('--crm-viewport-height', `${alto}px`);
      document.documentElement.style.setProperty('--crm-viewport-top', `${arriba}px`);
    });
  };
  window.addEventListener('resize', actualizar, { passive: true });
  window.visualViewport?.addEventListener('resize', actualizar, { passive: true });
  window.visualViewport?.addEventListener('scroll', actualizar, { passive: true });
  actualizar();
}
