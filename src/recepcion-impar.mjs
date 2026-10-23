import { q, tx } from './db.mjs';
import { emitir } from './realtime.mjs';
import { normalizar, sucursalDe } from './geografia-impar.mjs';

const central = nombre => /\bcentral\b/.test(normalizar(nombre));
const matriz = nombre => /\bmatriz\b/.test(normalizar(nombre));

// Orden solicitado por IMPAR. No cambia los IDs ni la asignación real de usuarios.
const ORDEN_MOSTRADO = [
  {p:0, etiqueta:'Matriz - Asunción', patron:/\bmatriz\b/},
  {p:1, etiqueta:'Lambaré', patron:/\blambare\b/},
  {p:2, etiqueta:'Fernando de la Mora', patron:/\bfernando de la mora\b|\bmadame lynch\b|\bfdo de la mora\b/},
  {p:3, etiqueta:'Ciudad del Este', patron:/\bciudad del este\b|\bcde\b/},
  {p:4, etiqueta:'Encarnación', patron:/\bencarnacion\b/},
  {p:5, etiqueta:'Pedro Juan Caballero', patron:/\bpedro juan caballero\b|\bpjc\b/}
];
const visualSucursal = nombre =>
  ORDEN_MOSTRADO.find(s => s.patron.test(normalizar(nombre))) || {p:99,etiqueta:nombre};
export const ordenarSucursalesRecepcion = opciones => [...opciones].sort((a,b) =>
  visualSucursal(a.nombre).p-visualSucursal(b.nombre).p ||
  a.nombre.localeCompare(b.nombre,'es') || String(a.id).localeCompare(String(b.id)));
export const textoMenuRecepcion = opciones =>
  opciones.map((s,i) => `${i+1} - ${visualSucursal(s.nombre).etiqueta}`).join('\n');

const destino = n => !n.canal_activo ? '' : String(n.canal_tipo).startsWith('whatsapp')
  ? ((n.canal_tipo === 'whatsapp_qr' && n.externos?.wa_jid) || n.telefono_destino || n.tel || n.externos?.whatsapp || '')
  : (n.externos?.[n.canal_tipo === 'messenger' ? 'messenger' : 'instagram'] || '');

export function elegirSucursal(texto, opciones) {
  const t = normalizar(texto);
  if (central(t)) return null;
  const numero = t.match(/^(?:(?:opcion|sucursal) )?(\d+)$/);
  if (numero) return opciones[Number(numero[1]) - 1] || null;
  const halladas = opciones.filter(s => {
    const alias = [normalizar(s.nombre), ...(matriz(s.nombre) ? ['matriz', 'casa matriz', 'asuncion', 'matriz asuncion']
      : [...(sucursalDe(s.nombre)?.alias || []), ...(normalizar(s.nombre).includes('fernando de la mora') ? ['fernando', 'fdo'] : [])]
        .filter(a => !central(a) && !matriz(a)))];
    return alias.some(a => a && (` ${t} `).includes(` ${a} `));
  });
  return halladas.length === 1 ? halladas[0] : null;
}

async function opcionesDisponibles(db, empresaId) {
  const { rows } = await db.query(`SELECT s.id,s.nombre FROM sucursales s
    WHERE s.empresa_id=$1 AND s.activa AND EXISTS (
      SELECT 1 FROM usuarios u WHERE u.empresa_id=s.empresa_id AND u.sucursal=s.nombre
        AND u.activo AND NOT u.oculto AND u.rol='agente') ORDER BY s.nombre,s.id`, [empresaId]);
  return ordenarSucursalesRecepcion(rows.filter(s => !central(s.nombre)));
}

async function cancelarPendientes(db, n) {
  await db.query(`UPDATE outbox SET estado='cancelado',error='Recepción finalizada o atención manual'
    WHERE empresa_id=$1 AND negociacion_id=$2 AND automatico=TRUE AND estado IN ('pendiente','error')`, [n.empresa_id,n.id]);
  await db.query(`UPDATE mensajes SET estado='cancelado' WHERE empresa_id=$1 AND negociacion_id=$2
    AND bot=TRUE AND dir='out' AND estado IN ('pendiente','error')`, [n.empresa_id,n.id]);
}

async function asignar(db, n, sucursal, motivo) {
  // Serializa el reparto por carga, incluso entre conversaciones distintas.
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [n.empresa_id+'-recepcion-asignacion']);
  const { rows } = await db.query(`SELECT u.id,u.nombre,u.sucursal,
    COUNT(ng.id) FILTER(WHERE ng.etapa NOT IN ('ganado','cerrado'))::int AS carga,MAX(ng.creado) AS ultima
    FROM usuarios u JOIN sucursales s ON s.empresa_id=u.empresa_id AND s.nombre=u.sucursal AND s.activa
    LEFT JOIN negociaciones ng ON ng.agente_id=u.id AND ng.empresa_id=u.empresa_id
    WHERE u.empresa_id=$1 AND s.id=$2 AND u.activo AND NOT u.oculto AND u.rol='agente'
    GROUP BY u.id ORDER BY carga,ultima ASC NULLS FIRST,u.id LIMIT 1`, [n.empresa_id,sucursal.id]);
  const agente = rows[0];
  if (!agente) return null;
  await db.query('UPDATE contactos SET responsable_id=$3,sucursal=$4 WHERE id=$1 AND empresa_id=$2 AND responsable_id IS NULL',
    [n.contacto_id,n.empresa_id,agente.id,agente.sucursal]);
  await db.query(`UPDATE negociaciones SET agente_id=$3,sucursal=$4,bot_activo=FALSE,recepcion_vence=NULL,
    bot_recepcion=$5,actualizado=now() WHERE id=$1 AND empresa_id=$2 AND agente_id IS NULL`,
    [n.id,n.empresa_id,agente.id,agente.sucursal,JSON.stringify({...n.bot_recepcion,fase:'finalizado',sucursal:agente.sucursal,motivo})]);
  await cancelarPendientes(db,n);
  await db.query(`INSERT INTO historial(empresa_id,negociacion_id,txt,por) VALUES($1,$2,$3,'Bot')`,
    [n.empresa_id,n.id,`Recepción: ${motivo} → ${agente.sucursal} · ${agente.nombre}`]);
  if (n.flags.notificaciones !== false) await db.query(`INSERT INTO notificaciones(empresa_id,usuario_id,tipo,titulo,msg,tono,ref)
    VALUES($1,$2,'nuevo','Cliente asignado por recepción',$3,'ok',$4)`, [n.empresa_id,agente.id,`${n.cliente} · ${agente.sucursal}`,n.id]);
  return agente;
}

export async function responderRecepcionImpar(empresaId, negId, { porVencimiento = false } = {}) {
  const resultado = await tx(async db => {
    const { rows } = await db.query(`SELECT n.*,c.nombre AS cliente,c.tel,c.externos,c.responsable_id,
      ca.tipo AS canal_tipo,ca.activo AS canal_activo,ca.bot_activo AS canal_bot,e.bot AS empresa_bot,e.flags,e.codigo
      FROM negociaciones n JOIN contactos c ON c.id=n.contacto_id AND c.empresa_id=n.empresa_id
      JOIN empresas e ON e.id=n.empresa_id AND e.activa
      LEFT JOIN canales ca ON ca.id=n.canal_id AND ca.empresa_id=n.empresa_id
      WHERE n.id=$1 AND n.empresa_id=$2 FOR UPDATE OF n,c`, [negId,empresaId]);
    const n = rows[0];
    if (!n || n.codigo !== 'impar' || !n.flags?.bot || !n.empresa_bot?.activo || n.empresa_bot?.recepcionImpar === false
      || !n.bot_activo || n.canal_bot === false || ['ganado','cerrado'].includes(n.etapa)) return null;
    const st = { ...n.bot_recepcion };
    const { rows: humanos } = await db.query(`SELECT 1 FROM mensajes WHERE empresa_id=$1 AND negociacion_id=$2
      AND dir='out' AND bot=FALSE LIMIT 1`, [empresaId,negId]);
    // Una ficha previa nunca adquiere elegibilidad por reactivar el bot manualmente.
    if (st.elegible !== true || st.version !== 2 || n.agente_id || n.responsable_id || humanos.length || st.fase === 'finalizado') {
      await db.query('UPDATE negociaciones SET bot_activo=FALSE,recepcion_vence=NULL WHERE id=$1 AND empresa_id=$2', [negId,empresaId]);
      await cancelarPendientes(db,n);
      return { silenciado: true };
    }
    if (!destino(n)) return null;
    const opciones = await opcionesDisponibles(db,empresaId);
    const { rows: hist } = await db.query(`SELECT id,dir,txt,bot,ts FROM mensajes WHERE negociacion_id=$1 AND empresa_id=$2
      ORDER BY ts DESC,id DESC LIMIT 30`, [negId,empresaId]);
    const entradas = hist[0]?.dir === 'in'
      ? hist.filter(m => m.dir === 'in' && Number(m.id) > Number(st.ultimo || 0)) : [];
    if (entradas.length) st.ultimo = Math.max(...entradas.map(m => Number(m.id)));
    // Una elección recibida dentro del plazo gana aunque el worker la procese después.
    if (st.fase === 'sucursal' && entradas.length) {
      const oportunas = entradas.filter(m => !n.recepcion_vence
        || new Date(m.ts || Date.now()).getTime() <= new Date(n.recepcion_vence).getTime());
      const texto = oportunas.map(m => String(m.txt || '').slice(0,1000)).reverse().join('\n');
      const elegida = elegirSucursal(texto,st.opciones || []);
      const disponible = elegida && opciones.find(s => s.id === elegida.id);
      if (disponible) {
        n.bot_recepcion=st;
        const agente = await asignar(db,n,disponible,'sucursal elegida por el cliente');
        if (agente) return { asignado: agente, notificar: n.flags.notificaciones !== false };
      }
    }
    const vencido = n.recepcion_vence && new Date(n.recepcion_vence).getTime() <= Date.now();
    if (vencido) {
      // Usar solamente Matriz, nunca Central ni otra sucursal como sustituto.
      const matrices = opciones.filter(s => matriz(s.nombre));
      const agente = matrices.length === 1 ? await asignar(db,n,matrices[0],'sin elección durante 2 horas') : null;
      if (agente) return { asignado: agente, notificar: n.flags.notificaciones !== false };
      if (!st.avisoMatriz) {
        await db.query(`INSERT INTO historial(empresa_id,negociacion_id,txt,por) VALUES($1,$2,$3,'Bot')`,
          [empresaId,negId,'Recepción vencida: falta una sucursal Matriz única con agentes activos. Se reintentará sin asignar a otra sucursal.']);
        await db.query(`INSERT INTO notificaciones(empresa_id,usuario_id,tipo,titulo,msg,tono,ref)
          SELECT $1,u.id,'nuevo','Recepción pendiente en Matriz',$3,'alerta',$2 FROM usuarios u
          WHERE u.empresa_id=$1 AND u.activo AND NOT u.oculto AND u.rol='admin'`, [empresaId,negId,'No hay una Matriz única con agentes activos para derivar al cliente.']);
        await db.query('UPDATE negociaciones SET bot_recepcion=$3 WHERE id=$1 AND empresa_id=$2',
          [negId,empresaId,JSON.stringify({...st,avisoMatriz:true})]);
      }
      return null;
    }
    if (porVencimiento) return null;
    if (!entradas.length) return null;
    if (st.fase === 'sucursal') {
      // No repetir el menú por cada mensaje ajeno a la selección ni extender las 2 horas.
      await db.query('UPDATE negociaciones SET bot_recepcion=$3 WHERE id=$1 AND empresa_id=$2', [negId,empresaId,JSON.stringify(st)]);
      return null;
    }
    st.fase='sucursal'; st.opciones=opciones;
    let respuesta='¡Hola! Te damos la bienvenida a Papelerías IMPAR. ¿Con qué sucursal querés hablar?';
    respuesta += opciones.length ? '\n'+textoMenuRecepcion(opciones)+'\nRespondé con el número o el nombre de la sucursal.'
      : '\nTu consulta será derivada a Matriz.';
    await db.query(`UPDATE negociaciones SET bot_recepcion=$3,recepcion_vence=now()+interval '2 hours'
      WHERE id=$1 AND empresa_id=$2`, [negId,empresaId,JSON.stringify(st)]);
    await db.query(`INSERT INTO mensajes(empresa_id,negociacion_id,dir,txt,bot,estado) VALUES($1,$2,'out',$3,true,'pendiente')`, [empresaId,negId,respuesta]);
    await db.query(`INSERT INTO outbox(empresa_id,canal_id,negociacion_id,destino,txt,automatico) VALUES($1,$2,$3,$4,$5,TRUE)`,
      [empresaId,n.canal_id,negId,destino(n),respuesta]);
    return { respondio: true };
  });
  if (resultado) {
    emitir(empresaId,'neg:patch',{id:negId});
    if (resultado.asignado) {
      emitir(empresaId,'neg:recargar',{});
      if (resultado.notificar) emitir(empresaId,'noti',{tipo:'nuevo',titulo:'Cliente asignado por recepción',msg:'Tenés un nuevo cliente asignado.',tono:'ok',ref:negId},[resultado.asignado.id]);
    }
  }
  return resultado;
}

let procesando=false;
export async function derivarRecepcionesVencidas() {
  if (procesando) return;
  procesando=true;
  try {
    const { rows } = await q(`SELECT n.id,n.empresa_id FROM negociaciones n JOIN empresas e ON e.id=n.empresa_id
      WHERE e.codigo='impar' AND e.activa AND e.flags->>'bot'='true' AND e.bot->>'activo'='true'
      AND n.bot_activo AND n.agente_id IS NULL AND n.recepcion_vence<=now()
      AND n.bot_recepcion->>'elegible'='true' AND n.bot_recepcion->>'fase'='sucursal'
      ORDER BY n.recepcion_vence,n.id LIMIT 100`);
    for (const n of rows) await responderRecepcionImpar(n.empresa_id,n.id,{porVencimiento:true});
  } finally { procesando=false; }
}
