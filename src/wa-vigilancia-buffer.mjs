/** Vigila bloqueos prolongados de eventos sin manipular sesiones Signal. */
export function vigilarBuffer({ sock, vigente, conectado, alLiberar, ahora = Date.now,
  intervalo = setInterval, cancelar = clearInterval, periodo = 10000, limite = 30000 }) {
  let desde = null;
  let timer;
  const detener = () => { if (timer != null) { cancelar(timer); timer = null; } };
  const revisar = () => {
    if (!vigente()) { detener(); return; }
    if (!conectado() || typeof sock.ev?.isBuffering !== 'function' || !sock.ev.isBuffering()) {
      desde = null;
      return;
    }
    const t = ahora();
    if (desde === null) { desde = t; return; }
    if (t - desde < limite || typeof sock.ev.flush !== 'function') return;
    // Baileys consolida los eventos antes de emitirlos; no se reinicia el socket.
    desde = null;
    if (sock.ev.flush()) alLiberar();
  };
  timer = intervalo(revisar, periodo);
  timer?.unref?.();
  return detener;
}
