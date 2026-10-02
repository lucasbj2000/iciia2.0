import { createHash } from 'node:crypto';
import { tx, telNorm } from './db.mjs';
import { hash } from './auth.mjs';
export const normalizarNombre=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase().replace(/\s+/g,' ');
export async function importarImpar(empresaId,data){
  if(data?.empresa!=='IMPAR'||data.version!==1||!Array.isArray(data.empleados)||!Array.isArray(data.clientes)||data.empleados.length>200||data.clientes.length>20000)throw new Error('Archivo IMPAR inválido.');
  const names=new Set(),users=new Set();
  for(const u of data.empleados){
    if(!u.nombre||!['gerente','jefe','agente'].includes(u.rol)||!/^[a-z0-9._-]{3,80}$/i.test(u.usuario||'')||String(u.password||'').length<8)throw new Error('Empleado incompleto o rol inválido.');
    if(users.has(u.usuario.toLowerCase())||names.has(normalizarNombre(u.nombre)))throw new Error('Empleado repetido en el archivo.');
    users.add(u.usuario.toLowerCase());names.add(normalizarNombre(u.nombre));
  }
  if(data.clientes.some(c=>!c.nombre))throw new Error('Hay clientes sin nombre.');
  const hashes=await Promise.all(data.empleados.map(u=>hash(u.password)));
  return tx(async c=>{
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[empresaId]);
    const {rows:emp}=await c.query("SELECT id FROM empresas WHERE id=$1 AND codigo='impar'",[empresaId]);
    if(!emp.length)throw new Error('Esta carga es exclusiva de IMPAR.');
    const summary={empleadosNuevos:0,empleadosExistentes:0,filasClientes:0,contactosNuevos:0,telefonosCompartidos:0,vendedoresSinVincular:{}};
    const map=new Map(),nuevos=new Set();
    for(const [i,u] of data.empleados.entries()){
      const {rows:prev}=await c.query('SELECT id FROM usuarios WHERE empresa_id=$1 AND lower(usuario)=$2',[empresaId,u.usuario.toLowerCase()]);
      if(prev.length){map.set(u.usuario,{...u,id:prev[0].id});summary.empleadosExistentes++;continue;}
      if(u.sucursal&&u.sucursal!=='Todas las sucursales')await c.query(`INSERT INTO sucursales(empresa_id,nombre,ciudad) SELECT $1,$2,$2 WHERE NOT EXISTS(SELECT 1 FROM sucursales WHERE empresa_id=$1 AND nombre=$2)`,[empresaId,u.sucursal]);
      const {rows}=await c.query(`INSERT INTO usuarios(empresa_id,nombre,usuario,pass_hash,rol,cargo,sucursal,linea,equipo) VALUES($1,$2,$3,$4,$5,$6,$7,'Ventas',$8) RETURNING id`,[empresaId,u.nombre,u.usuario.toLowerCase(),hashes[i],u.rol,u.cargo||'',u.sucursal||'',u.equipo||null]);
      map.set(u.usuario,{...u,id:rows[0].id});summary.empleadosNuevos++;nuevos.add(rows[0].id);
    }
    const gerente=[...map.values()].find(u=>u.rol==='gerente');
    for(const u of map.values()){
      if(!nuevos.has(u.id))continue;
      const superior=u.equipo?map.get(u.equipo):u.rol==='jefe'?gerente:null;
      // Reimportaciones no reemplazan los puestos ni las contraseñas modificadas.
      await c.query('UPDATE usuarios SET superior_id=$3 WHERE empresa_id=$1 AND id=$2 AND superior_id IS NULL',[empresaId,u.id,superior?.id||null]);
    }
    const {rows:emps}=await c.query('SELECT id,nombre,sucursal FROM usuarios WHERE empresa_id=$1 AND activo',[empresaId]);
    const vendedores=new Map();for(const u of emps){const key=normalizarNombre(u.nombre);if(vendedores.has(key))vendedores.set(key,null);else vendedores.set(key,u);}
    const {rows:contacts}=await c.query('SELECT id,doc,tel_norm,nombre,externos FROM contactos WHERE empresa_id=$1',[empresaId]);
    const byDoc=new Map(),byTel=new Map();
    for(const x of contacts){if(x.doc)byDoc.set(x.doc,x);if(x.externos?.sap)byDoc.set(x.externos.sap,x);if(x.tel_norm)byTel.set(x.tel_norm,x);}
    const occurrences=new Map();
    for(const d of data.clientes){
      const fingerprint=createHash('sha256').update(JSON.stringify([d.doc,d.sap,d.nombre,d.tipo,d.vendedor,d.tel,d.email])).digest('hex');
      const occurrence=(occurrences.get(fingerprint)||0)+1;occurrences.set(fingerprint,occurrence);
      const clave=fingerprint+':'+occurrence,doc=String(d.doc||''),sap=String(d.sap||'');
      const digits=String(d.tel||'').replace(/\D/g,''),tel=digits.length===9&&digits.startsWith('9')?'595'+digits:String(d.tel||'');
      let tn=digits.length>=8?telNorm(tel):'';
      const vendedor=vendedores.get(normalizarNombre(d.vendedor));
      if(d.vendedor&&!vendedor)summary.vendedoresSinVincular[d.vendedor]=(summary.vendedoresSinVincular[d.vendedor]||0)+1;
      const {rows:source}=await c.query('SELECT contacto_id FROM impar_clientes_fuente WHERE empresa_id=$1 AND clave=$2',[empresaId,clave]);
      let contact=source[0]?{id:source[0].contacto_id}:byDoc.get(sap)||byDoc.get(doc);
      const telephone=tn?byTel.get(tn):null;
      if(!contact&&telephone&&normalizarNombre(telephone.nombre)===normalizarNombre(d.nombre))contact=telephone;
      if(!contact){
        if(telephone){tn='';summary.telefonosCompartidos++;}
        const {rows}=await c.query(`INSERT INTO contactos(empresa_id,nombre,tel,tel_norm,email,doc,sucursal,linea,responsable_id,notas,externos) VALUES($1,$2,$3,$4,$5,$6,$7,'Ventas',$8,$9,$10) RETURNING id`,[empresaId,d.nombre,tel,tn,d.email||'',doc,vendedor?.sucursal||'',vendedor?.id||null,`Tipo de cliente: ${d.tipo||''} · Vendedor SAP: ${d.vendedor||''}`,JSON.stringify({sap,tipo_cliente:d.tipo||'',vendedor_sap:d.vendedor||''})]);
        contact={id:rows[0].id,nombre:d.nombre};summary.contactosNuevos++;
        if(sap)byDoc.set(sap,contact);if(doc)byDoc.set(doc,contact);if(tn)byTel.set(tn,contact);
      }else if(vendedor){
        await c.query('UPDATE contactos SET responsable_id=COALESCE(responsable_id,$3),sucursal=CASE WHEN sucursal=\'\' THEN $4 ELSE sucursal END WHERE empresa_id=$1 AND id=$2',[empresaId,contact.id,vendedor.id,vendedor.sucursal]);
      }
      await c.query(`INSERT INTO impar_clientes_fuente(empresa_id,clave,contacto_id,datos) VALUES($1,$2,$3,$4) ON CONFLICT(empresa_id,clave) DO UPDATE SET datos=EXCLUDED.datos,contacto_id=EXCLUDED.contacto_id,actualizado=now()`,[empresaId,clave,contact.id,JSON.stringify(d)]);
      summary.filasClientes++;
    }
    return {ok:true,...summary};
  });
}
