/** Ayudas guiadas de IMPAR: acceso y preferencias aplicadas en el servidor. */
import { Router } from 'express';
import { q, tx } from '../db.mjs';
import { requiere } from '../auth.mjs';
import { emitir } from '../realtime.mjs';
import { resolverGuia } from '../guia-reglas.mjs';
import { auditar } from '../core.mjs';

const r = Router();
r.use(requiere());
const MODOS = new Set(['heredar', 'mostrar', 'ocultar']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function estado(req) {
  const { rows: cfg } = await q(
    'SELECT general,mini_ayudas,bienvenida FROM guia_configuracion WHERE empresa_id=$1',
    [req.empresaId]
  );
  const { rows: pref } = await q(
    'SELECT modo,recorrido_visto FROM guia_preferencias WHERE empresa_id=$1 AND usuario_id=$2',
    [req.empresaId,req.user.id]
  );
  const config = cfg[0] || {general:false,mini_ayudas:true,bienvenida:true};
  const p = pref[0] || {modo:'heredar',recorrido_visto:false};
  return { ...resolverGuia(config,p), administrador: req.user.rol === 'admin' };
}

r.get('/estado', async (req,res,next) => {
  try {
    res.set('Cache-Control','no-store').json(await estado(req));
  } catch(e) { next(e); }
});

r.patch('/recorrido', async (req,res,next) => {
  try {
    if (typeof req.body?.visto !== 'boolean') return res.status(422).json({error:'Estado inválido'});
    await q(
      `INSERT INTO guia_preferencias (empresa_id,usuario_id,recorrido_visto)
       VALUES ($1,$2,$3)
       ON CONFLICT (empresa_id,usuario_id)
       DO UPDATE SET recorrido_visto=EXCLUDED.recorrido_visto,actualizado=now()`,
      [req.empresaId,req.user.id,req.body.visto]
    );
    res.json({ok:true});
  } catch(e) { next(e); }
});

r.get('/config', requiere('admin'), async (req,res,next) => {
  try {
    const [config,usuarios] = await Promise.all([
      q('SELECT general,mini_ayudas,bienvenida FROM guia_configuracion WHERE empresa_id=$1',[req.empresaId]),
      q(
        `SELECT u.id,u.nombre,u.usuario,u.rol,u.sucursal,COALESCE(g.modo,'heredar') AS modo
           FROM usuarios u LEFT JOIN guia_preferencias g
           ON g.usuario_id=u.id AND g.empresa_id=u.empresa_id
          WHERE u.empresa_id=$1 AND u.activo AND NOT u.oculto
          ORDER BY u.nombre`,[req.empresaId])
    ]);
    res.set('Cache-Control','no-store').json({
      config:config.rows[0] || {general:false,mini_ayudas:true,bienvenida:true},
      usuarios:usuarios.rows
    });
  } catch(e) { next(e); }
});

r.put('/config', requiere('admin'), async (req,res,next) => {
  try {
    const {general,mini_ayudas,bienvenida,usuarios} = req.body || {};
    if ([general,mini_ayudas,bienvenida].some(x=>typeof x!=='boolean') ||
        !Array.isArray(usuarios) || usuarios.length>1000 ||
        usuarios.some(x=>!x || !UUID.test(x.id) || !MODOS.has(x.modo))) {
      return res.status(422).json({error:'Configuración de ayudas inválida'});
    }
    const ids=usuarios.map(x=>x.id);
    if (new Set(ids).size!==ids.length) return res.status(422).json({error:'Usuarios duplicados'});
    await tx(async c=>{
      const {rows} = await c.query(
        'SELECT id FROM usuarios WHERE empresa_id=$1 AND activo AND id=ANY($2::uuid[])',
        [req.empresaId,ids]
      );
      if(rows.length!==ids.length) {
        const err=new Error('Algunos usuarios no pertenecen a IMPAR');
        err.status=422; throw err;
      }
      await c.query(
        `INSERT INTO guia_configuracion(empresa_id,general,mini_ayudas,bienvenida)
         VALUES ($1,$2,$3,$4) ON CONFLICT(empresa_id) DO UPDATE SET
         general=EXCLUDED.general,mini_ayudas=EXCLUDED.mini_ayudas,
         bienvenida=EXCLUDED.bienvenida,actualizado=NOW()`,
        [req.empresaId,general,mini_ayudas,bienvenida]
      );
      // No se borra recorrido_visto: el usuario no repite un tutorial ya completado.
      for(const u of usuarios) await c.query(
        `INSERT INTO guia_preferencias(empresa_id,usuario_id,modo) VALUES($1,$2,$3)
         ON CONFLICT(empresa_id,usuario_id) DO UPDATE SET modo=EXCLUDED.modo,actualizado=NOW()`,
        [req.empresaId,u.id,u.modo]
      );
    });
    auditar(req.empresaId,req.user.nombre,'Ayudas CRM','Configuración de guías actualizada',req.ip).catch(()=>{});
    // El evento no incluye información de la configuración ni de las personas.
    emitir(req.empresaId,'guias:cambio',{ts:Date.now()});
    res.json({ok:true});
  } catch(e) {
    if(e.status===422) return res.status(422).json({error:e.message});
    next(e);
  }
});

export default r;
