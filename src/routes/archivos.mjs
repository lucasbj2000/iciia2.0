import { Router } from 'express';
import { requiere } from '../auth.mjs';
import { leerMultipart, dimensiones } from '../multipart.mjs';
import { guardarBuffer, obtener, borrar, MAX_BYTES, mimePermitido, tipoDe, LIMITES_WA } from '../archivos.mjs';
import { auditar } from '../core.mjs';

const r = Router();

r.post('/', requiere(), async (req, res) => {
  try {
    if (!req.empresa?.flags?.adjuntos) return res.status(403).json({ error: 'Los adjuntos están desactivados.' });
    const { campos, archivos } = await leerMultipart(req, MAX_BYTES);
    if (!archivos.length) return res.status(422).json({ error: 'No se recibió ningún archivo.' });
    const f = archivos[0];
    if (!f.buffer.length) return res.status(422).json({ error: 'El archivo está vacío.' });
    if (!mimePermitido(f.mime))
      return res.status(415).json({ error: `Tipo no permitido (${f.mime}). Se aceptan imágenes, videos, audios y documentos.` });

    const dims = f.mime.startsWith('image/') ? dimensiones(f.buffer, f.mime) : {};
    const a = await guardarBuffer({ empresaId: req.empresaId, usuarioId: req.user.id, buffer: f.buffer,
      mime: f.mime, nombre: f.nombre, origen: campos.origen || 'agente', dims });
    const tipo = tipoDe(f.mime);
    const avisoWA = a.bytes > (LIMITES_WA[tipo] || Infinity)
      ? `El archivo pesa ${(a.bytes / 1048576).toFixed(1)} MB y WhatsApp limita ${tipo} a ${Math.round(LIMITES_WA[tipo] / 1048576)} MB. Puede que no se envíe.`
      : null;
    res.json({ ok: true, archivo: a, avisoWA });
  } catch (e) {
    res.status(413).json({ error: e.message });
  }
});

r.get('/util/limites', requiere(), (req, res) =>
  res.json({ maxBytes: MAX_BYTES, maxMB: Math.round(MAX_BYTES / 1048576), limitesWhatsApp: LIMITES_WA }));

r.get('/:id', requiere(), async (req, res) => {
  const a = await obtener(req.params.id, req.empresaId);
  if (!a) return res.status(404).json({ error: 'no encontrado' });
  res.json(a);
});

r.delete('/:id', requiere(), async (req, res) => {
  const a = await obtener(req.params.id, req.empresaId);
  if (!a) return res.status(404).json({ error: 'no encontrado' });
  if (a.usuario_id !== req.user.id && req.user.rol !== 'admin') return res.status(403).json({ error: 'sin permiso' });
  await borrar(req.params.id, req.empresaId);
  await auditar(req.empresaId, req.user.nombre, 'Archivo', `Eliminado ${a.nombre}`, req.ip);
  res.json({ ok: true });
});

export default r;
