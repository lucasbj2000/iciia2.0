/** Un chat por contacto; la negociación actual no absorbe registros anteriores. */
export function combinarHistorial(actuales=[],nuevos=[]) {
  const porId=new Map();
  for(const m of [...actuales,...nuevos])if(m?.id!=null)porId.set(String(m.id),m);
  const mensajes=[...porId.values()].sort((a,b)=>{
    const fecha=Date.parse(a.ts)-Date.parse(b.ts);
    if(fecha)return fecha;
    return BigInt(a.id)<BigInt(b.id)?-1:BigInt(a.id)>BigInt(b.id)?1:0;
  });
  return mensajes.map((m,i)=>({
    ...m,
    inicioConversacion: i===0 || mensajes[i-1].conversacion_id!==m.conversacion_id
  }));
}
