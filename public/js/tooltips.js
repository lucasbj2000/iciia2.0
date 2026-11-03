/* IMPAR · Tooltip de los botones con ícono (encabezado y pie del menú).
   Aparece al pasar el mouse y al enfocar con teclado; el nombre accesible es aria-label. */
const ZONA = 'header.top [title], header.top [data-tip], aside .me [title], aside .me [data-tip], .burger';
let tip = null, actual = null;

function preparar(el) {
  if (el.title) {
    if (!el.getAttribute('aria-label')) el.setAttribute('aria-label', el.title);
    el.dataset.tip = el.title;
    el.removeAttribute('title'); // el title nativo duplicaría el tooltip
  }
  return el.dataset.tip;
}
function mostrar(el) {
  const texto = preparar(el);
  if (!texto) return;
  actual = el;
  if (!tip) { tip = document.createElement('div'); tip.className = 'tip-impar'; tip.setAttribute('role', 'tooltip'); document.body.append(tip); }
  tip.textContent = texto;
  const r = el.getBoundingClientRect();
  const w = tip.offsetWidth, h = tip.offsetHeight;
  let x = r.left + r.width / 2 - w / 2;
  x = Math.max(8, Math.min(innerWidth - w - 8, x));
  let y = r.bottom + 8;
  if (y + h > innerHeight - 8) y = r.top - h - 8;
  tip.style.left = x + 'px'; tip.style.top = y + 'px';
  requestAnimationFrame(() => tip && actual === el && tip.classList.add('on'));
}
function ocultar() { actual = null; tip?.classList.remove('on'); }

const hoverReal = matchMedia('(hover: hover)');
document.addEventListener('pointerover', e => {
  if (!hoverReal.matches || e.pointerType === 'touch') return;
  const el = e.target.closest?.(ZONA); if (el && el !== actual) mostrar(el);
});
document.addEventListener('pointerout', e => { if (actual && !actual.contains(e.relatedTarget)) ocultar(); });
document.addEventListener('focusin', e => { const el = e.target.closest?.(ZONA); el && el.matches(':focus-visible') ? mostrar(el) : ocultar(); });
document.addEventListener('focusout', ocultar);
document.addEventListener('pointerdown', ocultar, true);
addEventListener('scroll', ocultar, true);
