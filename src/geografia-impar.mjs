import { readFileSync } from 'node:fs';
export const normalizar=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
const ciudades=JSON.parse(readFileSync(new URL('./data/ciudades-paraguay.json',import.meta.url),'utf8'));
const ciudad=n=>ciudades.find(c=>normalizar(c.nombre)===normalizar(n));
export const SUCURSALES=[
 {...ciudad('Encarnación'),nombre:'Encarnación',lat:-27.3300948,lon:-55.8638838,alias:['encarnacion','encar'],url:'https://maps.app.goo.gl/n3rQVGS6RgbmmFBw9'},
 {...ciudad('Ciudad del Este'),nombre:'Ciudad del Este',lat:-25.5050402,lon:-54.6376159,alias:['ciudad del este','cde'],url:'https://maps.app.goo.gl/FRrtz235XYe2txgs5'},
 {...ciudad('Pedro Juan Caballero'),nombre:'Pedro Juan Caballero',lat:-22.5620638,lon:-55.7210496,alias:['pedro juan caballero','pjc','pedro juan'],url:'https://maps.app.goo.gl/aQ5QE342Ht7wy6cx6'},
 {...ciudad('Lambaré'),nombre:'Lambaré',lat:-25.3526614,lon:-57.6023125,alias:['lambare'],url:'https://maps.app.goo.gl/rb9yf4BY7ogVcRq16'},
 {...ciudad('Asunción'),nombre:'Asunción',lat:-25.2991778,lon:-57.6356097,alias:['asuncion','asu','central','casa central','matriz','casa matriz'],url:'https://maps.app.goo.gl/FgndsmbgoqQ9Vzzn9'},
 {...ciudad('Fernando de la Mora'),nombre:'Madame Lynch',lat:-25.2892772,lon:-57.5488351,alias:['madame lynch','madam lynch','fernando de la mora','fdo de la mora','fdo de la mora madame lynch'],url:'https://maps.app.goo.gl/FgndsmbgoqQ9Vzzn9'}
];
// Distancia geográfica desde la ciudad informada; no estima rutas ni tiempos.
export function distancia(a,b){const rad=x=>x*Math.PI/180,lat=rad(b.lat-a.lat),lon=rad(b.lon-a.lon);const h=Math.sin(lat/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(lon/2)**2;return 6371*2*Math.atan2(Math.sqrt(h),Math.sqrt(1-h));}
const aliases=new Map();
for(const c of ciudades)for(const a of [c.nombre,...c.alias]){const k=normalizar(a);if(k.length>2&&!aliases.has(k))aliases.set(k,c);}
for(const [a,n] of Object.entries({'cde':'Ciudad del Este','pjc':'Pedro Juan Caballero','encar':'Encarnación','asu':'Asunción','fernando':'Fernando de la Mora','san pedro':'San Pedro de Ycuamandiyú','villa elisa':'Villa Elisa','capiata':'Capiatá'}))if(ciudad(n))aliases.set(a,ciudad(n));
aliases.set('madame lynch',ciudad('Fernando de la Mora'));
export function detectarCiudad(texto){
 const t=normalizar(texto),hits=[...aliases].filter(([a])=>(' '+t+' ').includes(' '+a+' ')).sort((a,b)=>b[0].length-a[0].length);
 if(!hits.length)return null;
 const primero=hits[0];
 if(hits.some(([a,c])=>c.id!==primero[1].id&&!primero[0].includes(a)))return null;
 return {...primero[1],expresion:primero[0]};
}
export function sucursalDe(nombre){const n=normalizar(nombre).replace(/^impar /,'');return SUCURSALES.find(s=>s.alias.includes(n)||normalizar(s.nombre)===n);}
export function masCercanas(c){const orden=SUCURSALES.map(s=>({...s,km:distancia(c,s)})).sort((a,b)=>a.km-b.km);return orden.filter(s=>s.km<=orden[0].km+0.05);}
export function nombreDelMensaje(texto,c,aceptarSoloNombre=false){
 let t=String(texto||'').trim();
 const explicito=t.match(/(?:me llamo|mi nombre es|nombre\s*:|soy)\s+([^\n,;.]+)/i);
 if(explicito)t=explicito[1];else if(!aceptarSoloNombre&&!c)return '';
 t=t.split(/\b(?:y (?:soy|vivo|resido)|vivo|resido|soy de|de la ciudad|ciudad\s*:|de|en)\b/i)[0];
 if(c){const limpio=normalizar(t),pos=limpio.indexOf(c.expresion);if(pos>=0)t=t.slice(0,pos);}
 t=t.replace(/^(?:hola|buenos dias|buenas tardes|buenas noches)[,! ]*/i,'').replace(/[\n,;]+/g,' ').replace(/\s+/g,' ').trim();
 if(!/^[\p{L}][\p{L} .'-]{1,79}$/u.test(t)||/^(?:hola|buenas|gracias|si|no|necesito|quiero|ubicacion|soy|vivo|resido)$/i.test(t)||normalizar(t)===normalizar(c?.nombre)||/\b(?:papel|resmas?|cartulina|carton|tinta|producto|precio|catalogo|quiero|necesito|resido|vivo)\b/i.test(t))return '';
 return t;
}
