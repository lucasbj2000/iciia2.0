import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { q } from '../db.mjs';
import { requiere } from '../auth.mjs';
import { emitir } from '../realtime.mjs';
import {
  tieneAccesoCampanas, listarPermisos, leerPlantillas, validarVariables, textoFinal,
  filtroContactos, prepararDestinos, crearCampana, resumenCampana, enviadosUltimas24h, normalizarTelefono, MAX_DESTINOS
} from '../campanas-impar.mjs';

const r = Router();
r.use(requiere());
r.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
const safe = fn => (req, res, next) => fn(req, res, next).catch(e => {
  console.error('[campañas api]', e.name, e.codigo || '');
  res.status(e.status || 500).json({ error: e.status ? e.message : (e.codigo ? `Meta: ${e.message}` : 'No se pudo completar la acción.') });
});
const soloAdmin = (req, res, next) => req.user.rol === 'admin' ? next() : res.status(403).json({ error: 'Solo administración puede cambiar los permisos de Campañas.' });

r.get('/acceso', safe(async (req, res) => {
  res.json({ acceso: await tieneAccesoCampanas(req.user, req.empresaId), admin: req.user.rol === 'admin' });
}));

/* Permisos (solo admin) */
r.get('/permisos', soloAdmin, safe(async (req, res) => res.json(await listarPermisos(req.empresaId))));
r.put('/permisos/:usuarioId', soloAdmin, safe(async (req, res) => {
  const { rows: [u] } = await q('SELECT id,rol FROM usuarios WHERE id=$1 AND empresa_id=$2', [req.params.usuarioId, req.empresaId]);
  if (!u) return res.status(404).json({ error: 'Usuario inexistente.' });
  if (u.rol === 'admin') return res.status(409).json({ error: 'Administración siempre tiene acceso a Campañas.' });
  if (req.body?.porDefecto === true) {
    await q('DELETE FROM campanas_accesos WHERE empresa_id=$1 AND usuario_id=$2', [req.empresaId, u.id]);
  } else {
    await q(`INSERT INTO campanas_accesos(empresa_id,usuario_id,permitido) VALUES($1,$2,$3)
             ON CONFLICT (empresa_id,usuario_id) DO UPDATE SET permitido=EXCLUDED.permitido,actualizado=now()`,
      [req.empresaId, u.id, req.body?.permitido === true]);
  }
  emitir(req.empresaId, 'campanas:permisos', { usuario: u.id }, [u.id]);
  res.json(await listarPermisos(req.empresaId));
}));

/* Todo lo demás exige acceso a Campañas */
r.use(safe(async (req, res, next) => {
  if (!(await tieneAccesoCampanas(req.user, req.empresaId))) return res.status(403).json({ error: 'No tenés acceso a Campañas. Pedíselo a administración.' });
  next();
}));
r.use(rateLimit({ windowMs: 60000, max: 120, standardHeaders: true, legacyHeaders: false }));

async function canalCloud(req, id) {
  const { rows: [c] } = await q("SELECT id,nombre,activo,config,tipo FROM canales WHERE id=$1 AND empresa_id=$2 AND tipo='whatsapp_api'", [id, req.empresaId]);
  if (!c) throw Object.assign(new Error('Elegí una línea de WhatsApp verificado (Cloud API).'), { status: 400 });
  return c;
}

r.get('/canales', safe(async (req, res) => {
  const { rows } = await q(
    "SELECT id,nombre,activo,config->>'numero' AS numero,config->>'phone_number_id' AS phone_id FROM canales WHERE empresa_id=$1 AND tipo='whatsapp_api' ORDER BY nombre",
    [req.empresaId]);
  res.json(await Promise.all(rows.map(async c => ({ id: c.id, nombre: c.nombre, activo: c.activo, numero: c.numero, usados24h: await enviadosUltimas24h(c.id) }))));
}));

r.get('/plantillas', safe(async (req, res) => {
  const canal = await canalCloud(req, req.query.canal);
  res.json(await leerPlantillas(canal));
}));

r.get('/contactos', safe(async (req, res) => {
  const f = filtroContactos(req.empresaId, req.query);
  const pagina = Math.max(0, Number(req.query.pagina) || 0);
  const [lista, total, bajas] = await Promise.all([
    q(`SELECT c.id,c.nombre,c.tel,c.sucursal,c.ciudad,n.etapa ${f.desde} ORDER BY c.nombre LIMIT 100 OFFSET ${pagina * 100}`, f.params),
    q(`SELECT count(*)::int AS n ${f.desde}`, f.params),
    q('SELECT telefono FROM campanas_bajas WHERE empresa_id=$1', [req.empresaId])
  ]);
  const deBaja = new Set(bajas.rows.map(b => b.telefono));
  res.json({ total: total.rows[0].n, pagina,
    contactos: lista.rows.map(c => ({ ...c, baja: deBaja.has(normalizarTelefono(c.tel)) })) });
}));

r.get('/filtros', safe(async (req, res) => {
  const [suc, ciu, et] = await Promise.all([
    q("SELECT DISTINCT sucursal AS v FROM contactos WHERE empresa_id=$1 AND coalesce(sucursal,'')<>'' ORDER BY 1", [req.empresaId]),
    q("SELECT ciudad AS v FROM contactos WHERE empresa_id=$1 AND coalesce(ciudad,'')<>'' GROUP BY 1 ORDER BY count(*) DESC LIMIT 40", [req.empresaId]),
    q("SELECT DISTINCT etapa AS v FROM negociaciones WHERE empresa_id=$1 ORDER BY 1", [req.empresaId])
  ]);
  res.json({ sucursales: suc.rows.map(x => x.v), ciudades: ciu.rows.map(x => x.v), etapas: et.rows.map(x => x.v) });
}));

/** Vista previa con un destinatario de ejemplo, sin crear nada. */
r.post('/vista-previa', safe(async (req, res) => {
  const { plantilla, variables, ejemplo } = req.body || {};
  if (!plantilla?.cuerpo) return res.status(400).json({ error: 'Falta la plantilla.' });
  res.json({ texto: textoFinal(plantilla, variables, ejemplo || { nombre: 'María González', datos: {} }), faltan: validarVariables(plantilla, variables) });
}));

r.get('/', safe(async (req, res) => {
  const { rows } = await q("SELECT id FROM campanas WHERE empresa_id=$1 ORDER BY creado DESC LIMIT 50", [req.empresaId]);
  res.json(await Promise.all(rows.map(c => resumenCampana(c.id, req.empresaId))));
}));

r.post('/', rateLimit({ windowMs: 60000, max: 10 }), safe(async (req, res) => {
  const b = req.body || {};
  const nombre = String(b.nombre || '').trim().slice(0, 120);
  if (!nombre) return res.status(400).json({ error: 'Poné un nombre a la campaña.' });
  const canal = await canalCloud(req, b.canal_id);
  // La plantilla se vuelve a leer de Meta: nunca se confía en la que manda el navegador.
  const plantilla = (await leerPlantillas(canal)).find(t => t.nombre === b.plantilla?.nombre && t.idioma === b.plantilla?.idioma);
  if (!plantilla) return res.status(400).json({ error: 'La plantilla no está aprobada en Meta o cambió. Volvé a elegirla.' });
  if (!plantilla.soportada) return res.status(400).json({ error: plantilla.motivo });
  const variables = b.variables || {};
  const faltan = validarVariables(plantilla, variables);
  if (faltan.length) return res.status(400).json({ error: `Completá las variables: ${faltan.join(', ')}.` });
  const limiteDiario = Math.min(100000, Math.max(1, Number(b.limite_diario) || 250));
  const { destinos, invalidos, bajas, deBaja } = await prepararDestinos(req.empresaId, b.destinos || {});
  if (!destinos.length) return res.status(400).json({ error: 'No hay destinatarios con un número válido.' });
  const id = await crearCampana({ empresaId: req.empresaId, usuarioId: req.user.id, canal, nombre, plantilla, variables, limiteDiario, destinos, deBaja });
  res.status(201).json({ id, total: destinos.length, bajas, invalidos: invalidos.length, ejemplosInvalidos: invalidos.slice(0, 5), limite: MAX_DESTINOS });
}));

r.get('/:id', safe(async (req, res) => {
  const c = await resumenCampana(req.params.id, req.empresaId);
  if (!c) return res.status(404).json({ error: 'Campaña inexistente.' });
  const [fallidos, usados] = await Promise.all([
    q(`SELECT nombre,telefono,estado,error,actualizado FROM campana_destinos
        WHERE campana_id=$1 AND estado IN ('fallido','omitido') ORDER BY actualizado DESC LIMIT 200`, [c.id]),
    c.canal_id ? enviadosUltimas24h(c.canal_id) : 0
  ]);
  res.json({ ...c, problemas: fallidos.rows, usados24h: usados });
}));

const cambiar = (de, a, extra = '') => safe(async (req, res) => {
  const { rowCount } = await q(`UPDATE campanas SET estado='${a}',error=NULL${extra} WHERE id=$1 AND empresa_id=$2 AND estado = ANY($3)`,
    [req.params.id, req.empresaId, de]);
  if (!rowCount) return res.status(409).json({ error: 'La campaña ya no está en un estado que permita esa acción.' });
  res.json(await resumenCampana(req.params.id, req.empresaId));
});
r.post('/:id/iniciar', cambiar(['borrador'], 'enviando', ',iniciado=now()'));
r.post('/:id/pausar', cambiar(['enviando'], 'pausada'));
r.post('/:id/reanudar', cambiar(['pausada'], 'enviando'));
r.post('/:id/cancelar', cambiar(['borrador', 'enviando', 'pausada'], 'cancelada', ',terminado=now()'));
r.delete('/:id', safe(async (req, res) => {
  const { rowCount } = await q("DELETE FROM campanas WHERE id=$1 AND empresa_id=$2 AND estado='borrador'", [req.params.id, req.empresaId]);
  if (!rowCount) return res.status(409).json({ error: 'Solo se pueden borrar campañas que no se enviaron.' });
  res.json({ ok: true });
}));

export default r;
