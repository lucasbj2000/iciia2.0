/** IMPAR · contador de reintentos acotado por sesión activa de Baileys.
 * Implementa el contrato CacheStore get/set/del que usa 6.7.24.
 * No contiene mensajes, números ni credenciales.
 */
export function crearCacheContadorReintentos({max=3500,ttlMs=60*60*1000}={}){
  const entradas=new Map();
  const key=k=>String(k);
  return {
    async get(k){
      const id=key(k),e=entradas.get(id);
      if(!e)return undefined;
      if(e.expira<=Date.now()){entradas.delete(id);return undefined;}
      return e.valor;
    },
    async set(k,valor,ttl){
      const id=key(k);
      // NodeCache espera duración en segundos si la proporciona Baileys.
      const expira=Date.now()+(Number(ttl)>0?Number(ttl)*1000:ttlMs);
      entradas.delete(id);
      entradas.set(id,{valor,expira});
      while(entradas.size>max)entradas.delete(entradas.keys().next().value);
      return true;
    },
    async del(k){entradas.delete(key(k));return true;},
    async flushAll(){entradas.clear();},
    async keys(){return [...entradas.keys()];},
  };
}
