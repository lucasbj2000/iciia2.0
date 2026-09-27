/** Canal realtime por SSE: emite diffs puntuales, nunca "todo de nuevo". */
const clientes = new Map();

export function sseHandler(req, res) {
  const eid = req.empresaId || 'global';
  res.writeHead(200, {
    'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive', 'X-Accel-Buffering': 'no'
  });
  res.write('retry: 4000\n\n');
  if (!clientes.has(eid)) clientes.set(eid, new Set());
  clientes.get(eid).add(res);
  res._uid = req.user.id;
  const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch (e) {} }, 25000);
  req.on('close', () => {
    clearInterval(ping);
    const s = clientes.get(eid);
    if (s) { s.delete(res); if (!s.size) clientes.delete(eid); }
  });
}

export function emitir(empresaId, evento, datos, soloUids) {
  const set = clientes.get(empresaId);
  if (!set || !set.size) return;
  const payload = `event: ${evento}\ndata: ${JSON.stringify(datos)}\n\n`;
  for (const res of set) {
    if (soloUids && soloUids.length && !soloUids.includes(res._uid)) continue;
    try { res.write(payload); } catch (e) {}
  }
}
export const conectados = eid => (clientes.get(eid) || new Set()).size;
