/** IMPAR · Reparación del cifrado con un cliente en la línea WhatsApp normal (QR).
 *
 * Síntoma: el cliente ve «Esperando mensaje» en lo que le mandamos y el CRM muestra
 * «El cliente envió un mensaje que WhatsApp no permitió leer». Pasa cuando la sesión
 * de cifrado (Signal) con ESE cliente quedó desfasada: cambió de teléfono, reinstaló
 * WhatsApp o usa un dispositivo vinculado nuevo.
 *
 * Solución: borrar solo la sesión de cifrado de ese cliente (número y LID, todos sus
 * dispositivos). El próximo mensaje arma una sesión nueva con claves frescas y el teléfono
 * del cliente la acepta. No toca la vinculación del QR ni a ningún otro cliente.
 * Nunca registra números, identificadores ni contenido en los logs.
 */

const VENTANA_MS = 30 * 60e3;   // fallas del mismo cliente que cuentan juntas
const UMBRAL = 2;               // fallas dentro de la ventana para reparar solo
const PAUSA_MS = 2 * 3600e3;    // entre dos reparaciones automáticas del mismo cliente

/** Usuario Signal de un JID: «595981…@s.whatsapp.net» o «123…:5@lid» → «595981…» / «123…». */
export function usuarioSignal(jid) {
  const s = String(jid || '').split('@')[0].split(':')[0];
  return /^\d{6,20}$/.test(s) ? s : '';
}

/** Archivos de sesión (useMultiFileAuthState) que pertenecen a esos usuarios: «session-<usuario>.<dispositivo>.json». */
export function sesionesDeUsuarios(archivos, usuarios) {
  const set = new Set([...usuarios].filter(Boolean));
  const ids = [];
  for (const f of archivos || []) {
    const m = /^session-(\d{6,20})\.(\d{1,3})\.json$/.exec(String(f));
    if (m && set.has(m[1])) ids.push(`${m[1]}.${m[2]}`);
  }
  return ids;
}

/** Registra una falla de cifrado del cliente y dice si corresponde repararlo automáticamente. Pura. */
export function registrarFalla(estado, usuario, ahora = Date.now()) {
  if (!usuario) return false;
  estado.fallas ||= new Map(); estado.reparados ||= new Map();
  const lista = (estado.fallas.get(usuario) || []).filter(t => ahora - t < VENTANA_MS);
  lista.push(ahora);
  estado.fallas.set(usuario, lista);
  if (estado.fallas.size > 5000) estado.fallas.delete(estado.fallas.keys().next().value); // tope de memoria
  if (lista.length < UMBRAL) return false;
  if (ahora - (estado.reparados.get(usuario) || 0) < PAUSA_MS) return false;
  estado.reparados.set(usuario, ahora);
  estado.fallas.delete(usuario);
  return true;
}
