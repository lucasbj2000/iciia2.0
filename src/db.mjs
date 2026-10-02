import pg from 'pg';
import bcrypt from 'bcryptjs';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { contextoAuditoria } from './contexto-auditoria.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
pg.types.setTypeParser(20, v => (v === null ? null : Number(v)));

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.PG_POOL_MAX || 10),
  idleTimeoutMillis: 30000
});
export const q = (text, params) => {
  const actor = contextoAuditoria.getStore();
  if (actor && /^\s*(INSERT|UPDATE|DELETE)\b/i.test(text) && /\b(usuarios|contactos|negociaciones)\b/i.test(text))
    return tx(c => c.query(text, params));
  return pool.query(text, params);
};
export async function tx(fn) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const actor = contextoAuditoria.getStore();
    if (actor) await c.query("SELECT set_config('impar.actor',$1,true),set_config('impar.actor_id',$2,true),set_config('impar.ip',$3,true)",
      [actor.usuario, actor.id, actor.ip]);
    const r = await fn(c); await c.query('COMMIT'); return r;
  }
  catch (e) { await c.query('ROLLBACK'); throw e; }
  finally { c.release(); }
}

/* ================= DEFAULTS ================= */
export const ETAPAS_DEF = [
  { id: 'nuevo', nombre: 'Nuevo Contacto', color: '#7db1ff', sistema: true, activa: true },
  { id: 'contactado', nombre: 'Contactado', color: '#fbd14b', sistema: true, activa: true },
  { id: 'espera', nombre: 'Cliente espera respuesta', color: '#ff8fd0', sistema: true, activa: true },
  { id: 'ganado', nombre: 'Cerrado Ganado', color: '#4ade80', sistema: true, activa: false },
  { id: 'cerrado', nombre: 'Cerrado', color: '#b9c2d0', sistema: true, activa: false }
];
export const MOTIVOS_DEF = ['Sin retorno', 'Sin stock', 'Solo consulta', 'Precio', 'Otros'];
export const MODULOS_DEF = ['negociaciones', 'contactos', 'comunicacion', 'calendario', 'reportes', 'configuracion'];

export const FLAGS_DEF = [
  { k: 'efectos', t: 'Efectos visuales', d: 'Animaciones, transiciones y microinteracciones.', v: true },
  { k: 'aurora', t: 'Fondo animado', d: 'Luces difusas animadas detrás de la interfaz.', v: true },
  { k: 'animacionesPlus', t: 'Animaciones avanzadas', d: 'Confeti al ganar, pulso en tarjetas nuevas, transiciones de vista.', v: true },
  { k: 'temaClaro', t: 'Permitir tema claro', d: 'Habilita el selector de tema para los usuarios.', v: true },
  { k: 'botonesPersonalizados', t: 'Botones personalizados', d: 'Acciones rápidas configurables en la conversación.', v: true },
  { k: 'clima', t: 'Clima del ingresante', d: 'Detecta la ciudad del usuario y muestra el clima.', v: true },
  { k: 'climaAuto', t: 'Clima por geolocalización', d: 'Si está off usa la ciudad de la sucursal.', v: true },
  { k: 'notificaciones', t: 'Centro de notificaciones', d: 'Campana, panel y avisos emergentes.', v: true },
  { k: 'notiSonido', t: 'Sonido en notificaciones', d: 'Tono corto al llegar un aviso.', v: false },
  { k: 'notiEscritorio', t: 'Notificaciones de escritorio', d: 'Avisos del navegador en otras pestañas.', v: false },
  { k: 'comunicacion', t: 'Comunicación interna', d: 'Chat entre empleados y grupos internos.', v: true },
  { k: 'gruposAgente', t: 'Agentes crean grupos', d: 'Si está off, solo el admin crea grupos.', v: false },
  { k: 'calendario', t: 'Calendario corporativo', d: 'Cumpleaños, feriados, actividades y reuniones.', v: true },
  { k: 'cumpleanos', t: 'Cumpleaños en calendario', d: 'Muestra los cumpleaños del equipo.', v: true },
  { k: 'cumpleAviso', t: 'Aviso de cumpleaños', d: 'Notifica los cumpleaños del día al ingresar.', v: true },
  { k: 'natalicioObligatorio', t: 'Fecha de nacimiento obligatoria', d: 'Pide la fecha al ingresar si falta.', v: true },
  { k: 'fechaCreacion', t: 'Marcador de fecha de creación', d: 'Fecha de alta en cada negociación.', v: true },
  { k: 'marcadorTransferido', t: 'Marcador de transferida', d: 'Identifica negociaciones transferidas.', v: true },
  { k: 'marcadorFrecuente', t: 'Marcador de cliente frecuente', d: 'Marca reingresos desde etapas cerradas.', v: true },
  { k: 'marcadorRegestion', t: 'Marcador de re gestionado', d: 'Marca negociaciones por re contacto.', v: true },
  { k: 'cargaManual', t: 'Carga manual de negociación', d: 'El admin carga negociaciones que no ingresaron.', v: true },
  { k: 'montoObligatorio', t: 'Monto obligatorio en Cerrado Ganado', d: 'Exige el monto de cierre.', v: true },
  { k: 'antiDuplicado', t: 'Anti duplicado en etapas activas', d: 'Un cliente no puede tener dos abiertas.', v: true },
  { k: 'eliminarNegociaciones', t: 'Eliminación de negociaciones', d: 'Borrado en lote o individual (admin).', v: true },
  { k: 'respuestasRapidas', t: 'Respuestas rápidas', d: 'Plantillas de mensaje con texto e imagen.', v: true },
  { k: 'adjuntos', t: 'Adjuntos en conversaciones', d: 'Enviar imágenes, videos, audios y documentos.', v: true },
  { k: 'detectarUbicacion', t: 'Detección de direcciones', d: 'Identifica ubicaciones que envía el cliente.', v: true },
  { k: 'geocodificarTexto', t: 'Geocodificar direcciones escritas', d: 'Convierte el texto en coordenadas del mapa.', v: true },
  { k: 'botAutoOff', t: 'Bot se apaga al responder el agente', d: 'Silencia el bot al intervenir una persona.', v: true },
  { k: 'autoCierre', t: 'Cierre automático por SLA', d: 'Cierra como «Sin retorno» al vencer el SLA.', v: true },
  { k: 'asignacionEquitativa', t: 'Asignación equitativa', d: 'Reparte contactos entre agentes disponibles.', v: true },
  { k: 'asignarPorSucursal', t: 'Asignar por sucursal del canal', d: 'El contacto va a agentes de la sucursal del canal.', v: true },
  { k: 'solicitudContacto', t: 'Solicitud de contacto', d: 'Bloquea duplicados y pide autorización.', v: true },
  { k: 'stock', t: 'Sector de stock / catálogo', d: 'Link de catálogo visible para los usuarios.', v: true },
  { k: 'bot', t: 'Bot de recepción', d: 'Respuesta automática al ingresar un contacto.', v: true },
  { k: 'whatsapp', t: 'Canal WhatsApp', d: 'WhatsApp por QR y Cloud API.', v: true },
  { k: 'meta', t: 'Canales Meta', d: 'Facebook Messenger e Instagram Direct.', v: true },
  { k: 'exportar', t: 'Exportación de datos', d: 'Descarga de contactos y reportes en CSV.', v: true },
  { k: 'importar', t: 'Importación de contactos', d: 'Carga masiva por CSV con actualización.', v: true }
];

export const NOTI_DEF = [
  { k: 'nuevo', t: 'Nuevo contacto asignado', msg: 'Se te asignó {cliente} desde {origen}', dest: 'agente', v: true, tono: 'ok' },
  { k: 'retorno', t: 'Cliente respondió', msg: '{cliente} está esperando respuesta', dest: 'agente', v: true, tono: 'warn' },
  { k: 'sla', t: 'SLA por vencer', msg: '{cliente} lleva {tiempo} sin retorno', dest: 'agente+jefe', v: true, tono: 'warn' },
  { k: 'autocierre', t: 'Cierre automático', msg: '{cliente} se cerró por falta de retorno', dest: 'agente+jefe', v: true, tono: 'bad' },
  { k: 'transfer', t: 'Negociación transferida', msg: '{origenUsr} te transfirió {cliente}', dest: 'agente', v: true, tono: 'ok' },
  { k: 'ganado', t: 'Cierre ganado', msg: '{agente} cerró ganado a {cliente} por {monto}', dest: 'jefe+gerente', v: true, tono: 'ok' },
  { k: 'solicitud', t: 'Solicitud de contacto', msg: '{origenUsr} solicita el contacto {cliente}', dest: 'agente', v: true, tono: 'warn' },
  { k: 'mensaje', t: 'Mensaje interno', msg: '{origenUsr}: {texto}', dest: 'destinatario', v: true, tono: 'ok' },
  { k: 'manual', t: 'Negociación cargada a mano', msg: 'El admin cargó manualmente {cliente}', dest: 'agente', v: true, tono: 'ok' },
  { k: 'canal', t: 'Estado de canal', msg: 'El canal {canal} está {estado}', dest: 'admin', v: true, tono: 'warn' },
  { k: 'cuarentena', t: 'Mensaje sin procesar', msg: '{cantidad} mensaje(s) en cuarentena, revisá el panel', dest: 'admin', v: true, tono: 'bad' },
  { k: 'ubicacion', t: 'Ubicación recibida', msg: '{cliente} compartió una dirección: {direccion}', dest: 'agente', v: true, tono: 'ok' },
  { k: 'cumple', t: 'Cumpleaños del día', msg: 'Hoy cumple años {persona} 🎂', dest: 'agente+jefe+gerente', v: true, tono: 'ok' },
  { k: 'evento', t: 'Evento del calendario', msg: '{evento} · {fecha}', dest: 'agente+jefe+gerente', v: true, tono: 'ok' },
  { k: 'duplicado', t: 'Intento de duplicado', msg: '{cliente} ya tiene una negociación abierta con {agente}', dest: 'agente', v: true, tono: 'warn' }
];

export const REGLAS_DEF = {
  slaHoras: 24, jornadaIni: 8, jornadaFin: 17,
  diasHabiles: [1, 2, 3, 4, 5], avisoSlaPct: 70, paisFeriados: 'PY', prefijoPais: '595',
  botones: [
    { id: 'b1', icono: '📍', texto: 'Pedir ubicación', accion: 'mensaje',
      valor: '¿Me compartís tu ubicación para coordinar el envío? Podés mandarla desde el clip 📎 → Ubicación.', color: '#38bdf8' },
    { id: 'b2', icono: '📋', texto: 'Enviar catálogo', accion: 'catalogo', valor: '', color: '#FF7A00' },
    { id: 'b3', icono: '✅', texto: 'Confirmar pedido', accion: 'mensaje',
      valor: '¡Perfecto! Tu pedido quedó confirmado. En breve te paso el detalle del envío.', color: '#22c55e' },
    { id: 'b4', icono: '⏰', texto: 'Pedir un momento', accion: 'mensaje',
      valor: 'Dame un momento por favor, estoy verificando la disponibilidad y te confirmo enseguida.', color: '#f59e0b' }
  ]
};
export const BOT_DEF = {
  activo: true,
  instrucciones: 'Sos el asistente virtual de la empresa. Saludá, identificá la necesidad del cliente y derivá a un agente disponible.'
};
export const flagsDefault = () => Object.fromEntries(FLAGS_DEF.map(f => [f.k, f.v]));

/* ================= MIGRACIONES ================= */
export async function migrar() {
  const dir = join(__dirname, 'migrations');
  const files = readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
  await q(`CREATE TABLE IF NOT EXISTS _migraciones (nombre TEXT PRIMARY KEY, ts TIMESTAMPTZ NOT NULL DEFAULT now())`);
  for (const f of files) {
    const { rows } = await q('SELECT 1 FROM _migraciones WHERE nombre=$1', [f]);
    if (rows.length) continue;
    console.log('› migrando', f);
    await q(readFileSync(join(dir, f), 'utf8'));
    await q('INSERT INTO _migraciones(nombre) VALUES($1)', [f]);
  }
}

/* ================= SEMILLA ================= */
export async function seed() {
  const { rows } = await q("SELECT * FROM empresas WHERE codigo='impar'");
  const { rows: total } = await q('SELECT count(*)::int AS n FROM empresas');
  if (total[0].n > (rows.length ? 1 : 0)) throw new Error('Ejecutá scripts/preparar-impar.sh para convertir esta instancia a IMPAR.');
  const empresa = rows[0] || await crearEmpresa({ codigo: 'impar', nombre: 'IMPAR', color: '#75b936', ciudad: 'Asunción' });
  await q("UPDATE empresas SET nombre='IMPAR',color='#75b936',logo='/assets/impar-logo.jpg',activa=TRUE WHERE id=$1", [empresa.id]);
  const { rows: admins } = await q("SELECT id FROM usuarios WHERE empresa_id=$1 AND rol='admin'", [empresa.id]);
  if (!admins.length) {
    if (!process.env.ADMIN_PASS) throw new Error('Falta ADMIN_PASS en .env.');
    await q(`INSERT INTO usuarios (empresa_id,nombre,usuario,pass_hash,rol,sucursal,linea,disponibilidad)
      VALUES ($1,'Administrador IMPAR','admin',$2,'admin','Central','Línea 1','disponible')`,
      [empresa.id, await bcrypt.hash(process.env.ADMIN_PASS, 12)]);
  }
}

export async function crearEmpresa({ codigo, nombre, color, ciudad }) {
  return tx(async c => {
    const { rows } = await c.query(
      `INSERT INTO empresas (codigo,nombre,color,ciudad,etapas,motivos,modulos,lineas,flags,notis,reglas,stock,bot)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [codigo, nombre, color || '#FF7A00', ciudad || 'Asunción',
       JSON.stringify(ETAPAS_DEF), JSON.stringify(MOTIVOS_DEF), JSON.stringify(MODULOS_DEF),
       JSON.stringify(['Línea 1']), JSON.stringify(flagsDefault()), JSON.stringify(NOTI_DEF),
       JSON.stringify(REGLAS_DEF), JSON.stringify({ link: 'https://www.impar-papeles.com.py', nota: 'Papeles e Insumos Gráficos · IMPAR' }), JSON.stringify(BOT_DEF)]);
    const emp = rows[0];
    await c.query(`INSERT INTO sucursales (empresa_id,nombre,ciudad) VALUES ($1,'Central',$2)`, [emp.id, ciudad || 'Asunción']);
    await c.query(
      `INSERT INTO rapidas (empresa_id,txt,ambito) VALUES
        ($1,'¡Hola! Gracias por escribirnos. ¿En qué puedo ayudarte?','empresa'),
        ($1,'Te paso nuestro catálogo actualizado para que lo veas.','empresa'),
        ($1,'Perfecto, quedo atento a tu confirmación. ¡Muchas gracias!','empresa')`, [emp.id]);
    return emp;
  });
}

export const telNorm = t => String(t || '').replace(/\D/g, '').slice(-8);
