/** Parser multipart/form-data sin dependencias, con límite de tamaño. */
export function leerMultipart(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const ct = req.headers['content-type'] || '';
    const m = ct.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
    if (!m) return reject(new Error('Petición sin boundary multipart'));
    const boundary = Buffer.from('--' + (m[1] || m[2]).trim());
    const trozos = []; let total = 0, abortado = false;

    req.on('data', c => {
      if (abortado) return;
      total += c.length;
      if (total > maxBytes + 8192) {
        abortado = true; req.destroy();
        const lim = (maxBytes / 1048576).toFixed(maxBytes < 1048576 ? 2 : 0);
        return reject(new Error(`El archivo supera el límite de ${lim} MB`));
      }
      trozos.push(c);
    });
    req.on('error', e => { if (!abortado) reject(e); });
    req.on('end', () => {
      if (abortado) return;
      try {
        const buf = Buffer.concat(trozos);
        const campos = {}, archivos = [];
        let pos = buf.indexOf(boundary);
        if (pos < 0) return reject(new Error('Cuerpo multipart inválido'));
        pos += boundary.length;
        while (pos < buf.length) {
          if (buf[pos] === 45 && buf[pos + 1] === 45) break;
          if (buf[pos] === 13 && buf[pos + 1] === 10) pos += 2;
          const finCab = buf.indexOf('\r\n\r\n', pos);
          if (finCab < 0) break;
          const cab = buf.slice(pos, finCab).toString('utf8');
          const ini = finCab + 4;
          const sig = buf.indexOf(boundary, ini);
          if (sig < 0) break;
          let fin = sig;
          if (buf[fin - 2] === 13 && buf[fin - 1] === 10) fin -= 2;
          const nombre = (cab.match(/name="([^"]*)"/i) || [])[1];
          const archivo = (cab.match(/filename="([^"]*)"/i) || [])[1];
          const mime = (cab.match(/Content-Type:\s*([^\r\n]+)/i) || [])[1];
          if (archivo !== undefined) {
            if (archivo) archivos.push({ campo: nombre, nombre: archivo,
              mime: (mime || 'application/octet-stream').trim(), buffer: buf.slice(ini, fin) });
          } else if (nombre) campos[nombre] = buf.slice(ini, fin).toString('utf8');
          pos = sig + boundary.length;
        }
        resolve({ campos, archivos });
      } catch (e) { reject(e); }
    });
  });
}

/** Dimensiones desde la cabecera binaria (PNG, GIF, WebP, JPEG). */
export function dimensiones(buf, mime) {
  try {
    if (mime === 'image/png' && buf.length > 24) return { ancho: buf.readUInt32BE(16), alto: buf.readUInt32BE(20) };
    if (mime === 'image/gif' && buf.length > 10) return { ancho: buf.readUInt16LE(6), alto: buf.readUInt16LE(8) };
    if (mime === 'image/webp' && buf.length > 30 && buf.slice(12, 16).toString() === 'VP8 ')
      return { ancho: buf.readUInt16LE(26) & 0x3fff, alto: buf.readUInt16LE(28) & 0x3fff };
    if (mime === 'image/jpeg') {
      let i = 2;
      while (i < buf.length - 9) {
        if (buf[i] !== 0xff) { i++; continue; }
        const marca = buf[i + 1];
        if (marca >= 0xc0 && marca <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marca))
          return { alto: buf.readUInt16BE(i + 5), ancho: buf.readUInt16BE(i + 7) };
        i += 2 + buf.readUInt16BE(i + 2);
      }
    }
  } catch (e) {}
  return {};
}
