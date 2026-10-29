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
 console.log('Interpretación: 0 mensajes capturados mientras WhatsApp muestra conexión abierta puede indicar bloqueo de eventos Baileys o restricción de cuenta.');
 console.log('Cuarentena significa mensajes recibidos por el CRM pero pendientes de revisión del worker.');
}catch(e){
 console.error('No se pudo consultar el estado sin revelar datos privados ('+(e.code||e.name)+').');
 process.exitCode=1;
}finally{await pool.end();}
