#!/usr/bin/env node
/** IMPAR · reporte agrupado de entrega real, sin imprimir clientes ni números.
 * Ejecutar dentro de /opt/iciia-crm, después de migración 020.
 */
import 'dotenv/config';
import {pool} from '../src/db.mjs';
try{
 const {rows}=await pool.query(
  "SELECT e.jid_tipo,COUNT(*)::int AS total, "+
  "COUNT(*) FILTER(WHERE e.ack>=3)::int AS entregados, "+
  "COUNT(*) FILTER(WHERE e.ack=2)::int AS solo_servidor, "+
  "COUNT(*) FILTER(WHERE e.ack<2)::int AS sin_servidor, "+
  "COUNT(*) FILTER(WHERE e.ack<3 AND e.creado<now()-interval '5 minutes')::int AS no_confirmados_5m "+
  "FROM wa_entregas_impar e JOIN empresas emp ON emp.id=e.empresa_id "+
  "WHERE emp.codigo='impar' AND e.outbox_id IS NOT NULL "+
  "AND e.creado>=now()-interval '24 hours' "+
  "GROUP BY e.jid_tipo ORDER BY e.jid_tipo");
 console.log('=== IMPAR: ENTREGA WHATSAPP EN ÚLTIMAS 24 HORAS ===');
 if(!rows.length)console.log('Sin envíos nuevos registrados desde la actualización.');
 for(const r of rows){
  console.log((r.jid_tipo||'desconocido')+': '+r.total+' mensajes · '+
   r.entregados+' entregados · '+r.solo_servidor+' sólo servidor · '+
   r.sin_servidor+' sin ACK servidor · '+r.no_confirmados_5m+' sin entrega luego de 5 min');
 }
 console.log('Los acuses pueden demorarse o no llegar al CRM por condiciones de la sesión.');
 console.log('El reporte no revela números telefónicos ni contenido de conversaciones.');
}catch(e){
 console.error('No se pudo consultar entregas (¿migración aplicada?): '+e.message);
 process.exitCode=1;
}finally{await pool.end();}
