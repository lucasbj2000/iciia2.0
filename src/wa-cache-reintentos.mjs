/** IMPAR · contador de reintentos acotado por sesión activa de Baileys.
 * Baileys 6.7.24 usa get/set/del SIN await. Deben devolver valores,
 * no promesas: una Promise produce count="[object Promise]1" en el
 * recibo de reintento e impide solicitar el original al teléfono.
 * No contiene cuerpos de mensajes ni credenciales.
 */
export function crearCacheContadorReintentos({max=3500,ttlMs=60*60*1000,ahora=Date.now}={}){
  const entradas=new Map();
  const key=k=>String(k);
  return {
    get(k){
      const id=key(k),e=entradas.get(id);
      if(!e)return undefined;
      if(e.expira<=ahora()){entradas.delete(id);return undefined;}
      return e.valor;
    },
    set(k,valor,ttl){
      const id=key(k);
      // NodeCache espera duración en segundos si la proporciona Baileys.
      const expira=ahora()+(Number(ttl)>0?Number(ttl)*1000:ttlMs);
      entradas.delete(id);
      entradas.set(id,{valor,expira});
      while(entradas.size>max)entradas.delete(entradas.keys().next().value);
      return true;
    },
    del(k){return Number(entradas.delete(key(k)));},
    flushAll(){entradas.clear();},
    keys(){return [...entradas.keys()];},
  };
}
