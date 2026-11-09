/* Ventana de retorno de Facebook: avisa al CRM (misma dirección) y se cierra. */
(() => {
  const caja = document.getElementById('meta-retorno');
  if (!caja) return;
  const aviso = { tipo: 'meta-login', state: caja.dataset.state, estado: caja.dataset.estado };
  try { const canal = new BroadcastChannel('impar-meta-login'); canal.postMessage(aviso); setTimeout(() => canal.close(), 500); } catch { /* el CRM también consulta al servidor */ }
  try { window.opener?.postMessage(aviso, location.origin); } catch { /* sin ventana de origen */ }
  document.getElementById('cerrar').onclick = () => window.close();
  if (aviso.estado === 'listo') setTimeout(() => window.close(), 1800);
})();
