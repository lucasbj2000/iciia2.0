/* Solo recursos públicos. Nunca guarda sesiones, API, mensajes ni datos del CRM. */
const CACHE='impar-publico-v1';
const OFFLINE='/offline.html';
const BASICOS=[OFFLINE,'/manifest.webmanifest','/assets/impar-app-192.png','/assets/impar-app-512.png'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(c=>c.addAll(BASICOS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('impar-publico-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  const r=event.request,u=new URL(r.url);
  if(r.method!=='GET'||u.origin!==self.location.origin||r.headers.has('Authorization')||/^\/(api|media|webhook)(\/|$)/.test(u.pathname))return;
  if(r.mode==='navigate'){event.respondWith(fetch(r).catch(()=>caches.match(OFFLINE)));return;}
  if(!BASICOS.includes(u.pathname))return;
  event.respondWith(fetch(r).then(async response=>{if(response.ok){const cache=await caches.open(CACHE);await cache.put(r,response.clone());}return response;}).catch(()=>caches.match(r)));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  const ref=event.notification.data?.ref;
  event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(async clients=>{
    const client=clients.find(c=>new URL(c.url).origin===self.location.origin);
    if(client){await client.focus();if(ref)client.postMessage({tipo:'abrir-negociacion',ref});}
    else await self.clients.openWindow('/');
  }));
});
