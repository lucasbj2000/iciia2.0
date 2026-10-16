import { tx } from './db.mjs';
import { consultarPrincipalCentral } from './principal-central-impar.mjs';

const fallo = (status, mensaje) => { throw Object.assign(new Error(mensaje), { status }); };

// Una apertura solo consulta. La negociación y la salida se guardan juntas al enviar.
export async function conversacionContacto(req, contactoId, envio = null) {
  return tx(async db => {
    const { rows: contactos } = await db.query(
      'SELECT * FROM contactos WHERE id=$1 AND empresa_id=$2 FOR UPDATE', [contactoId, req.empresaId]);
    const c = contactos[0], u = req.user;
    if (!c) fallo(404, 'Contacto no encontrado.');
    // Todos los usuarios activos de IMPAR pueden iniciar un chat con un
    // contacto registrado, incluso si pertenece a otra sucursal. Si ya hay
    // una negociación abierta, se respeta su responsable y no se duplica.
    const activas = (req.empresa.etapas || []).filter(e => e.activa).map(e => e.id);
    const { rows: abiertas } = await db.query(`SELECT n.id,n.etapa,n.agente_id,n.sucursal,n.linea,
      u.nombre AS responsable FROM negociaciones n LEFT JOIN usuarios u ON u.id=n.agente_id
      WHERE n.empresa_id=$1 AND n.contacto_id=$2 AND n.etapa=ANY($3) ORDER BY n.creado LIMIT 1`,
      [req.empresaId, c.id, activas]);
    if (abiertas[0]) {
      const n = abiertas[0], propia = n.agente_id === u.id;
      return { activa: true, propia, id: propia ? n.id : null, etapa: n.etapa,
        sucursal: n.sucursal, linea: n.linea, responsable: n.responsable || 'Sin asignar' };
    }
    // ÚNICAMENTE la línea institucional de Central; no filtrar por
    // sucursal ni por línea del empleado. La búsqueda es la misma para
    // agentes, jefes, gerentes y administración.
    const principal = await consultarPrincipalCentral(db,req.empresaId);
    const canales=[principal];
    if (!envio) return { activa: false, nombre: c.nombre, tel: c.tel, canales };
    const texto = String(envio.texto || '').trim();
    if (!texto || texto.length > 10000) fallo(422, 'Escribí un mensaje de hasta 10.000 caracteres.');
    // Resolver siempre en el servidor la línea activa y correcta, incluso
    // si el navegador conservó un selector desactualizado.
    if(envio.canalId && envio.canalId!==principal.id)
      fallo(409,'Esta conversación debe iniciarse desde la línea principal de Central. Actualizá la ventana.');
    const canal=principal;
    let destino = String(c.tel || '').replace(/\D/g, '');
    if (destino.length === 10 && destino.startsWith('09')) destino = destino.slice(1);
    if (destino.length === 9 && destino.startsWith('9')) destino = '595' + destino;
    if (destino.startsWith('0') || destino.length < 10 || destino.length > 15) fallo(422, 'Revisá el teléfono del contacto e incluí el código de país.');
    if (!activas.includes('contactado')) fallo(422, 'La etapa Contactado debe estar activa.');
    const { rows: nuevas } = await db.query(`INSERT INTO negociaciones
      (empresa_id,contacto_id,titulo,etapa,origen,canal_id,agente_id,sucursal,linea,bot_activo)
      VALUES($1,$2,$3,'contactado','whatsapp',$4,$5,$6,$7,FALSE) RETURNING id`,
      [req.empresaId,c.id,`Conversación · ${c.nombre}`,canal.id,u.id,u.sucursal || sucursal || '',canal.linea || u.linea || c.linea || '']);
    const id = nuevas[0].id;
    await db.query(`INSERT INTO mensajes(empresa_id,negociacion_id,dir,txt,autor_id,estado)
      VALUES($1,$2,'out',$3,$4,'pendiente')`, [req.empresaId,id,texto,u.id]);
    await db.query(`INSERT INTO outbox(empresa_id,canal_id,negociacion_id,destino,txt)
      VALUES($1,$2,$3,$4,$5)`, [req.empresaId,canal.id,id,destino,texto]);
    await db.query(`UPDATE contactos SET responsable_id=COALESCE(responsable_id,$3)
      WHERE empresa_id=$1 AND id=$2`, [req.empresaId,c.id,u.id]);
    await db.query(`INSERT INTO historial(empresa_id,negociacion_id,txt,por)
      VALUES($1,$2,'Conversación iniciada desde Contactos · primer mensaje en cola',$3)`, [req.empresaId,id,u.nombre]);
    return { activa: false, creada: true, id, etapa: 'contactado' };
  });
}
