/** Conexión con el CRM: recibe órdenes por SSE y manda eventos por POST. Reconecta sola. */
export function lectorSSE(alEvento) {
  let buf = '', evento = 'message', datos = [];
  return texto => {
    buf += texto;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const linea = buf.slice(0, i).replace(/\r$/, ''); buf = buf.slice(i + 1);
      if (linea === '') { if (datos.length) alEvento(evento, datos.join('\n')); evento = 'message'; datos = []; }
      else if (linea.startsWith('event:')) evento = linea.slice(6).trim();
      else if (linea.startsWith('data:')) datos.push(linea.slice(5).replace(/^ /, ''));
    }
  };
}

export class CRM {
  constructor({ url, token, log = console.log, fetchImpl = fetch }) {
    if (!/^https?:\/\//.test(url || '')) throw new Error('Falta CRM_URL (por ejemplo https://crm.iciia.tech).');
    if (!/^pst_[\w-]{40,60}$/.test(token || '')) throw new Error('Falta PASARELA_TOKEN o no es válido (se genera en el CRM → Llamadas · Prueba).');
    Object.assign(this, { url: url.replace(/\/$/, ''), token, log, fetchImpl });
    this.detenido = false; this.conectado = false;
  }
  cabeceras(json) { return { Authorization: `Bearer ${this.token}`, ...(json ? { 'Content-Type': 'application/json' } : {}) }; }
  async enviar(evento) {
    const r = await this.fetchImpl(`${this.url}/api/pasarela/evento`, { method: 'POST', headers: this.cabeceras(true), body: JSON.stringify(evento), signal: AbortSignal.timeout(15000) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `El CRM respondió ${r.status}`);
    return j;
  }
  /** Escucha órdenes para siempre; ante un corte espera y reconecta (3 s → 30 s). */
  async escuchar(alComando, alConectar = () => {}) {
    let espera = 3000;
    while (!this.detenido) {
      try {
        const r = await this.fetchImpl(`${this.url}/api/pasarela/eventos`, { headers: this.cabeceras(false) });
        if (r.status === 401) { this.log('El CRM rechazó el token de la pasarela. Generá uno nuevo en el CRM y actualizá el archivo de configuración.'); await new Promise(ok => setTimeout(ok, 60000)); continue; }
        if (!r.ok || !r.body) throw new Error(`El CRM respondió ${r.status}`);
        this.conectado = true; espera = 3000; this.log('Conectada al CRM.'); alConectar();
        const leer = lectorSSE((ev, d) => { if (ev === 'cmd') { try { alComando(JSON.parse(d)); } catch (e) { this.log('Orden inválida: ' + e.message); } } });
        const dec = new TextDecoder();
        let ultima = Date.now();
        const vigia = setInterval(() => { if (Date.now() - ultima > 70000) { try { lector.cancel(); } catch { /* nada */ } } }, 10000);
        const lector = r.body.getReader();
        try { for (;;) { const { done, value } = await lector.read(); if (done) break; ultima = Date.now(); leer(dec.decode(value, { stream: true })); } }
        finally { clearInterval(vigia); }
        throw new Error('El CRM cerró la conexión');
      } catch (e) {
        if (this.conectado) this.log('Se cortó la conexión con el CRM: ' + e.message);
        this.conectado = false;
        await new Promise(ok => setTimeout(ok, espera)); espera = Math.min(espera * 2, 30000);
      }
    }
  }
}
