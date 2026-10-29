#!/usr/bin/env node
/** IMPAR · Diagnóstico read-only de recepción. No muestra teléfonos, mensajes ni tokens. */
import 'dotenv/config';
import {pool} from '../src/db.mjs';
console.log('=== IMPAR · Recepción últimas 24 horas (sin datos privados) ===');
try{
 const {rows}=await pool.query(
  "SELECT c.tipo,c.nombre AS canal,i.estado,COUNT(*)::int AS cantidad, "+
  "MAX(i.ts) AS ultimo, COUNT(*) FILTER(WHERE i.ts>now()-interval '1 hour')::int AS hora "+
  "FROM inbox i JOIN canales c ON c.id=i.canal_id "+
  "JOIN empresas e ON e.id=i.empresa_id "+
  "WHERE e.codigo='impar' AND i.ts>now()-interval '24 hours' "+
  "GROUP BY c.tipo,c.nombre,i.estado ORDER BY c.nombre,i.estado");
 if(!rows.length)console.log('No hay entradas guardadas durante este período.');
 for(const x of rows){
  console.log((x.canal||'canal')+' ['+x.tipo+'] · '+x.estado+': '+x.cantidad+
    ' en 24h · '+x.hora+' en 1h · último '+new Date(x.ultimo).toISOString());
 }
 const {rows:recientes}=await pool.query(
  "SELECT date_trunc('hour',i.ts) AS hora,COUNT(*)::int AS ingresados "+
  "FROM inbox i JOIN empresas e ON e.id=i.empresa_id "+
  "WHERE e.codigo='impar' AND i.tipo='whatsapp_qr' "+
  "AND i.ts>now()-interval '6 hours' GROUP BY 1 ORDER BY 1");
 console.log('Recepción QR por hora, últimas 6 horas:');
 for(const x of recientes)console.log(new Date(x.hora).toISOString()+' · '+x.ingresados);
 const {rows:flujo}=await pool.query(
  "SELECT COUNT(*)::int AS total,"+
  "COUNT(*) FILTER(WHERE i.estado='procesado')::int AS procesados,"+
  "COUNT(*) FILTER(WHERE i.estado='procesado' AND m.id IS NULL)::int AS procesados_sin_mensaje,"+
  "COUNT(*) FILTER(WHERE m.id IS NOT NULL)::int AS incluidos_en_chat,"+
  "COUNT(*) FILTER(WHERE m.id IS NOT NULL AND n.agente_id IS NULL)::int AS sin_agente,"+
  "COUNT(*) FILTER(WHERE i.remitente LIKE '%@lid')::int AS lid_sin_telefono,"+
  "COUNT(*) FILTER(WHERE i.estado='capturando')::int AS adjuntos_pendientes "+
  "FROM inbox i JOIN empresas e ON e.id=i.empresa_id "+
  "LEFT JOIN mensajes m ON m.empresa_id=i.empresa_id AND m.msg_id=i.ext_id AND m.dir='in' "+
  "LEFT JOIN negociaciones n ON n.id=m.negociacion_id "+
  "WHERE e.codigo='impar' AND i.tipo='whatsapp_qr' AND i.ts>now()-interval '24 hours'"
 );
 const x=flujo[0];
 if(x){
  console.log('--- Recorrido real de mensajes QR en 24 horas ---');
  console.log('Capturados por WhatsApp/CRM: '+x.total);
  console.log('Marcados como procesados: '+x.procesados);
  console.log('Asociados a una conversación: '+x.incluidos_en_chat);
  console.log('PROCESADOS SIN MENSAJE EN CONVERSACIÓN: '+x.procesados_sin_mensaje);
  console.log('Con mensaje pero sin agente asignado: '+x.sin_agente);
  console.log('Remitentes identificados solo por LID: '+x.lid_sin_telefono);
  console.log('Multimedia todavía en captura: '+x.adjuntos_pendientes);
 }
 console.log('Interpretación: si los mensajes no aparecen aquí, Baileys no está entregando el evento o falla el INSERT de inbox.');
 console.log('Si hay procesados sin mensaje, investigar la ingesta y duplicados; si existen chats sin agente, revisar el reparto.');
 console.log('Cuarentena significa mensajes recibidos por el CRM pero pendientes de revisión del worker.');
}catch(e){
 console.error('No se pudo consultar el estado sin revelar datos privados ('+(e.code||e.name)+').');
 process.exitCode=1;
}finally{await pool.end();}
