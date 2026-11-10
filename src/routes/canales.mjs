import { Router } from 'express';
import { q } from '../db.mjs';
import { requiere } from '../auth.mjs';
import { auditar } from '../core.mjs';
import * as baileys from '../channels/baileys.mjs';
import * as meta from '../channels/meta.mjs';
import { cifrarToken, tokenConfigurado, resolverToken } from '../meta-secretos-impar.mjs';
import { resolverCuentaSocial, suscribirPagina } from '../redes-sociales-impar.mjs';

const r = Router();
const TIPOS = ['whatsapp_qr', 'whatsapp_api', 'messenger', 'instagram'];
export const ETIQUETAS = {
  whatsapp_qr: 'WhatsApp (QR)', whatsapp_api: 'WhatsApp Cloud API',
  messenger: 'Facebook Messenger', instagram: 'Instagram Direct'
};

/** Nunca devolver tokens completos al navegador. */
function sanear(c) {
  const cfg = { ...(c.config || {}) };
  if (cfg.token) cfg.token = '•••••• configurado';
  return { ...c, config: cfg, etiqueta: ETIQUETAS[c.tipo] };
}

/* ---------- LISTADO ---------- */
/** Solo el estado (sin QR ni datos del canal): para el indicador del encabezado de todos los usuarios. */
r.get('/estado-whatsapp', requiere(), async (req, res) => {
  const { rows } = await q("SELECT id FROM canales WHERE empresa_id=$1 AND activo AND tipo='whatsapp_qr'", [req.empresaId]);
  if (!rows.length) return res.json({ estado: null });
  const estados = rows.map(c => baileys.estadoSesion(c.id).estado || 'desconectado');
  const peor = ['desconectado', 'error', 'pendiente', 'reconectando', 'conectando'].find(e => estados.includes(e));
  res.json({ estado: peor || 'conectado' });
});

r.get('/', requiere(), async (req, res) => {
  const { rows } = await q(
    `SELECT c.*, s.nombre AS sucursal_nombre, s.ciudad AS sucursal_ciudad
       FROM canales c LEFT JOIN sucursales s ON s.id = c.sucursal_id
      WHERE c.empresa_id=$1 ORDER BY s.nombre NULLS FIRST, c.creado`, [req.empresaId]);
  res.json(rows.map(c => {
    const s = sanear(c);
    if (c.tipo === 'whatsapp_qr') {
      const e = baileys.estadoSesion(c.id);
      s.estado = e.estado; s.qr = e.qr; s.numero = e.numero || c.numero;
      if (e.error) s.ultimo_error = e.error;
    }
    return s;
  }));
});

/* ---------- RESUMEN POR SUCURSAL ---------- */
r.get('/por-sucursal', requiere(), async (req, res) => {
  const { rows: sucs } = await q(
    'SELECT id, nombre, ciudad, activa FROM sucursales WHERE empresa_id=$1 ORDER BY nombre', [req.empresaId]);
  const { rows: cans } = await q('SELECT * FROM canales WHERE empresa_id=$1', [req.empresaId]);
  const conEstado = cans.map(c => {
    const s = sanear(c);
    if (c.tipo === 'whatsapp_qr') {
      const e = baileys.estadoSesion(c.id);
      s.estado = e.estado; s.numero = e.numero || c.numero;
    }
    return s;
  });
  res.json({
    sucursales: sucs.map(s => ({ ...s, canales: conEstado.filter(c => c.sucursal_id === s.id) })),
    sinSucursal: conEstado.filter(c => !c.sucursal_id)
  });
});

/* ---------- ALTA ---------- */
r.post('/', requiere('admin'), async (req, res) => {
  const b = req.body || {};
  if (!TIPOS.includes(b.tipo)) return res.status(422).json({ error: 'Tipo de canal inválido.' });
  if (!b.nombre) return res.status(422).json({ error: 'El nombre es obligatorio.' });

  if (b.sucursalId) {
    const { rows } = await q('SELECT 1 FROM sucursales WHERE id=$1 AND empresa_id=$2', [b.sucursalId, req.empresaId]);
    if (!rows.length) return res.status(404).json({ error: 'La sucursal no pertenece a esta empresa.' });
  }

  const config = {};
  if (b.tipo === 'whatsapp_qr') {
    config.prefijoPais = b.prefijoPais || process.env.PREFIJO_PAIS || '595';
    if (!(await baileys.disponible()))
      return res.status(503).json({ error: 'Baileys no está instalado en el servidor. Ejecutá: npm i @whiskeysockets/baileys' });
  } else if (b.tipo === 'whatsapp_api') {
    if (!b.token || !/^\d{5,25}$/.test(String(b.phone_number_id||'')))
      return res.status(422).json({ error: 'Cloud API requiere token y Phone Number ID numérico.' });
    if (!process.env.META_APP_SECRET || !process.env.META_VERIFY_TOKEN)
      return res.status(503).json({ error: 'Configurá META_APP_SECRET y META_VERIFY_TOKEN de forma segura en Hostinger.' });
    try{
      Object.assign(config, { token: cifrarToken(b.token), phone_number_id: String(b.phone_number_id),
        waba_id: String(b.waba_id||''), prefijoPais: b.prefijoPais || process.env.PREFIJO_PAIS || '595' });
    }catch(e){return res.status(503).json({error:e.message});}
  } else {
    // Messenger / Instagram: con el token alcanza; el CRM encuentra la página, su Instagram y el token de página.
    const r = await resolverCuentaSocial({ tipo: b.tipo, token: b.token, page_id: b.page_id, ig_id: b.ig_id });
    if (r.elegir) return res.status(422).json({ error: 'El token tiene varias páginas: elegí cuál conectar.', elegir: r.elegir });
    if (!r.ok) return res.status(422).json({ error: r.error });
    try {
      Object.assign(config, { token: cifrarToken(r.cuenta.token_pagina), page_id: r.cuenta.page_id, ig_id: r.cuenta.ig_id,
        page_nombre: r.cuenta.page_nombre, ig_usuario: r.cuenta.ig_usuario });
    } catch (e) { return res.status(503).json({ error: e.message }); }
  }

  /* Un mismo phone_number_id / page_id no puede repetirse: Meta enruta el webhook
     a un único canal. La verificación es global, pero solo se revela el nombre del
     canal si pertenece a esta empresa. */
  const clave = b.tipo === 'whatsapp_api' ? 'phone_number_id' : (b.tipo === 'instagram' ? 'ig_id' : 'page_id');
  if (config[clave]) {
    const { rows } = await q(
      `SELECT nombre, empresa_id FROM canales WHERE tipo=$1 AND config->>$2=$3`,
      [b.tipo, clave, config[clave]]);
    if (rows.length) {
      const propio = rows[0].empresa_id === req.empresaId;
      return res.status(409).json({
        error: propio
          ? `Ese ${clave} ya está usado por el canal «${rows[0].nombre}».`
          : `Ese ${clave} ya está registrado en el sistema. Verificá los datos.`
      });
    }
  }

  const { rows } = await q(
    `INSERT INTO canales (empresa_id,sucursal_id,linea,tipo,nombre,config,sesion,activo)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [req.empresaId, b.sucursalId || null, b.linea || '', b.tipo, b.nombre, JSON.stringify(config),
     b.tipo === 'whatsapp_qr' ? `${req.empresa.codigo}-${Date.now().toString(36)}` : null,
     b.tipo !== 'whatsapp_api']);
  // Redes sociales: arrancan sin respuestas automáticas; se encienden desde el canal cuando se decida.
  if (['messenger', 'instagram'].includes(b.tipo)) {
    await q('UPDATE canales SET bot_activo=FALSE WHERE id=$1 AND empresa_id=$2', [rows[0].id, req.empresaId]);
    rows[0].bot_activo = false;
  }

  // Verificación inmediata para los canales de Meta
  let prueba = null;
  if (b.tipo !== 'whatsapp_qr') {
    prueba = await meta.probarCanal({ ...rows[0], config });
    await q(`UPDATE canales SET estado=$3, numero=COALESCE(NULLIF($4,''),numero), ultimo_error=$5,
               ultima_conexion=CASE WHEN $6 THEN now() ELSE ultima_conexion END
             WHERE id=$1 AND empresa_id=$2`,
      [rows[0].id, req.empresaId, prueba.ok && b.tipo==='whatsapp_api' ? 'verificado' : prueba.ok ? 'conectado' : 'error', prueba.numero || '',
       prueba.ok ? null : prueba.error, prueba.ok]);
  }
  let suscripcion = null;
  if (['messenger', 'instagram'].includes(b.tipo)) {
    suscripcion = await suscribirPagina(config.page_id, resolverToken(config.token));
    if (!suscripcion.ok) await q('UPDATE canales SET estado=$3, ultimo_error=$4 WHERE id=$1 AND empresa_id=$2',
      [rows[0].id, req.empresaId, 'error', 'No se pudo suscribir la página al webhook: ' + suscripcion.error]);
  }
  await auditar(req.empresaId, req.user.nombre, 'Canal', `Alta ${ETIQUETAS[b.tipo]} · ${b.nombre}`, req.ip);
  res.json({ ok: true, canal: sanear(rows[0]), prueba, suscripcion, pendienteActivacion: b.tipo==='whatsapp_api' });
});

/* ---------- HACER PRINCIPAL Y COMPARTIDA ---------- */
/** Línea normal que se usa para escribir a contactos nuevos (cuando la verificada no puede por las 24 h). */
r.post('/:id/salida-nueva', requiere('admin'), async (req, res) => {
  const { rows } = await q('SELECT id,nombre,tipo,activo FROM canales WHERE id=$1 AND empresa_id=$2', [req.params.id, req.empresaId]);
  const canal = rows[0];
  if (!canal || !canal.activo || canal.tipo !== 'whatsapp_qr')
    return res.status(422).json({ error: 'Elegí una línea de WhatsApp normal (QR) activa.' });
  await q(`UPDATE canales SET config=CASE WHEN id=$2 THEN jsonb_set(COALESCE(config,'{}'::jsonb),'{salida_nueva}','true'::jsonb,true)
           ELSE COALESCE(config,'{}'::jsonb)-'salida_nueva' END WHERE empresa_id=$1 AND tipo='whatsapp_qr'`, [req.empresaId, canal.id]);
  await auditar(req.empresaId, req.user.nombre, 'Canal', 'Línea para contactos nuevos: ' + canal.nombre, req.ip);
  res.json({ ok: true, id: canal.id, nombre: canal.nombre });
});

r.post('/:id/principal-global', requiere('admin'), async(req,res)=>{
  const {rows}=await q(
    "SELECT c.id,c.nombre,c.tipo,c.activo,s.nombre AS sucursal_nombre "+
    "FROM canales c LEFT JOIN sucursales s ON s.id=c.sucursal_id AND s.empresa_id=c.empresa_id "+
    "WHERE c.id=$1 AND c.empresa_id=$2",
    [req.params.id,req.empresaId]);
  const canal=rows[0];
  if(!canal||!canal.activo||!['whatsapp_qr','whatsapp_api'].includes(canal.tipo))
    return res.status(422).json({error:'Seleccioná una línea WhatsApp activa de IMPAR.'});
  // Solo una línea principal para toda IMPAR; preservar los tokens y el resto de
  // configuración, así como su sucursal, credenciales y el número conectado.
  await q(
    "UPDATE canales SET config=CASE WHEN id=$2 THEN jsonb_set(COALESCE(config,'{}'::jsonb),'{principal_global}','true'::jsonb,true) "+
    "ELSE COALESCE(config,'{}'::jsonb)-'principal_global' END "+
    "WHERE empresa_id=$1 AND tipo IN ('whatsapp_qr','whatsapp_api')",
    [req.empresaId,canal.id]);
  await auditar(req.empresaId,req.user.nombre,'Canal principal',
    'WhatsApp compartido para todas las sucursales: '+canal.nombre,req.ip);
  res.json({ok:true,id:canal.id,nombre:canal.nombre});
});

/* ---------- EDITAR ---------- */
r.patch('/:id', requiere('admin'), async (req, res) => {
  const b = req.body || {};
  const { rows } = await q('SELECT * FROM canales WHERE id=$1 AND empresa_id=$2', [req.params.id, req.empresaId]);
  const c = rows[0];
  if (!c) return res.status(404).json({ error: 'no encontrado' });

  const config = { ...(c.config || {}) };
  const social = ['messenger', 'instagram'].includes(c.tipo);
  const tokenNuevo = b.token !== undefined && b.token !== '' && !String(b.token).startsWith('••••');
  if (social && tokenNuevo) {
    // Token nuevo de red social: se vuelve a resolver la misma página y se guarda el token de página cifrado.
    const r = await resolverCuentaSocial({ tipo: c.tipo, token: b.token, page_id: config.page_id, ig_id: config.ig_id });
    if (!r.ok) return res.status(422).json({ error: r.error || 'El token no tiene acceso a la página de este canal.' });
    try { config.token = cifrarToken(r.cuenta.token_pagina); } catch (e) { return res.status(503).json({ error: e.message }); }
    Object.assign(config, { page_nombre: r.cuenta.page_nombre, ig_usuario: r.cuenta.ig_usuario });
    const sus = await suscribirPagina(config.page_id, r.cuenta.token_pagina);
    if (!sus.ok) return res.status(409).json({ error: 'Token válido, pero no se pudo suscribir la página: ' + sus.error });
  }
  for (const k of social ? ['prefijoPais'] : ['token', 'phone_number_id', 'waba_id', 'page_id', 'ig_id', 'prefijoPais']) {
    if (b[k] !== undefined && b[k] !== '' && !String(b[k]).startsWith('••••')) {
      if(k==='token' && c.tipo==='whatsapp_api'){
        try{config[k]=cifrarToken(b[k]);}
        catch(e){return res.status(503).json({error:e.message});}
      }else config[k]=b[k];
    }
  }
  if(c.tipo==='whatsapp_api' && b.activo===true && c.activo!==true){
    if(!process.env.META_APP_SECRET || !process.env.META_VERIFY_TOKEN)
      return res.status(409).json({error:'Webhook de Meta sin secreto y Verify Token configurados.'});
    const p=await meta.probarCanal({...c,config});
    if(!p.ok)return res.status(409).json({error:'Primero verificá el token y el Phone Number ID: '+p.error});
  }
  await q(
    `UPDATE canales SET nombre=COALESCE($3,nombre), sucursal_id=$4, linea=COALESCE($5,linea),
       config=$6, activo=COALESCE($7,activo) WHERE id=$1 AND empresa_id=$2`,
    [c.id, req.empresaId, b.nombre, b.sucursalId === undefined ? c.sucursal_id : (b.sucursalId || null),
     b.linea, JSON.stringify(config), typeof b.activo === 'boolean' ? b.activo : null]);
  await auditar(req.empresaId, req.user.nombre, 'Canal', `Edición ${c.nombre}`, req.ip);
  res.json({ ok: true });
});

/* ---------- BORRAR ---------- */
r.delete('/:id', requiere('admin'), async (req, res) => {
  const { rows } = await q('SELECT * FROM canales WHERE id=$1 AND empresa_id=$2', [req.params.id, req.empresaId]);
  if (!rows[0]) return res.status(404).json({ error: 'no encontrado' });
  if (rows[0].tipo === 'whatsapp_qr') { try { await baileys.desvincular(rows[0]); } catch (e) {} }
  await q('DELETE FROM canales WHERE id=$1 AND empresa_id=$2', [rows[0].id, req.empresaId]);
  await auditar(req.empresaId, req.user.nombre, 'Canal', `Baja ${rows[0].nombre}`, req.ip);
  res.json({ ok: true });
});

/* ---------- WHATSAPP QR ---------- */
r.post('/:id/conectar', requiere('admin'), async (req, res) => {
  const { rows } = await q("SELECT * FROM canales WHERE id=$1 AND empresa_id=$2 AND tipo='whatsapp_qr'",
    [req.params.id, req.empresaId]);
  const c = rows[0];
  if (!c) return res.status(404).json({ error: 'canal QR no encontrado' });
  try { res.json({ ok: true, ...(await baileys.iniciar(c)) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

r.get('/:id/qr', requiere('admin'), async (req, res) => {
  const { rows } = await q('SELECT 1 FROM canales WHERE id=$1 AND empresa_id=$2', [req.params.id, req.empresaId]);
  if (!rows.length) return res.status(404).json({ error: 'no encontrado' });
  res.json(baileys.estadoSesion(req.params.id));
});

r.post('/:id/desvincular', requiere('admin'), async (req, res) => {
  const { rows } = await q('SELECT * FROM canales WHERE id=$1 AND empresa_id=$2', [req.params.id, req.empresaId]);
  if (!rows[0]) return res.status(404).json({ error: 'no encontrado' });
  await baileys.desvincular(rows[0]);
  await auditar(req.empresaId, req.user.nombre, 'Canal', `Desvinculado ${rows[0].nombre}`, req.ip);
  res.json({ ok: true });
});

/* ---------- PROBAR ---------- */
r.post('/:id/probar', requiere('admin'), async (req, res) => {
  const { rows } = await q('SELECT * FROM canales WHERE id=$1 AND empresa_id=$2', [req.params.id, req.empresaId]);
  const c = rows[0];
  if (!c) return res.status(404).json({ error: 'no encontrado' });
  if (c.tipo === 'whatsapp_qr') {
    const e = baileys.estadoSesion(c.id);
    return res.json({ ok: e.estado === 'conectado', info: e,
      error: e.estado === 'conectado' ? null : 'La sesión no está vinculada. Escaneá el QR.' });
  }
  const p = await meta.probarCanal(c);
  // Probar también renueva la suscripción de la página (por si alguien la quitó desde Meta).
  if (p.ok && ['messenger', 'instagram'].includes(c.tipo) && c.config?.page_id) {
    const sus = await suscribirPagina(c.config.page_id, resolverToken(c.config.token));
    if (!sus.ok) Object.assign(p, { ok: false, error: 'Credenciales bien, pero la página no quedó suscrita al webhook: ' + sus.error });
  }
  await q(`UPDATE canales SET estado=$3, numero=COALESCE(NULLIF($4,''),numero), ultimo_error=$5
            WHERE id=$1 AND empresa_id=$2`,
    [c.id, req.empresaId, p.ok && c.tipo==='whatsapp_api' ? 'verificado' : p.ok ? 'conectado' : 'error', p.numero || '', p.ok ? null : p.error]);
  res.json(p);
});

/* ---------- DATOS DEL WEBHOOK ---------- */
r.get('/webhook/info', requiere('admin'), (req, res) => {
  const base = (process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  res.json({
    url: `${base}/webhook/meta`,
    verifyToken: process.env.META_VERIFY_TOKEN || '',
    tieneSecret: !!process.env.META_APP_SECRET,
    tieneCifrado: /^[0-9a-f]{64}$/i.test(process.env.META_TOKEN_ENCRYPTION_KEY||''),
    listoParaCloud: !!process.env.META_APP_SECRET && !!process.env.META_VERIFY_TOKEN && /^[0-9a-f]{64}$/i.test(process.env.META_TOKEN_ENCRYPTION_KEY||''),
    https: base.startsWith('https://'),
    eventos: { whatsapp_api: ['messages'], messenger: ['messages', 'messaging_postbacks'], instagram: ['messages'] }
  });
});

export default r;
