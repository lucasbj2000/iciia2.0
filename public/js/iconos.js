/* IMPAR · Un solo juego de íconos de línea (24×24, trazo 1,8, puntas redondeadas).
   Reemplaza a los emojis de la interfaz: se ven iguales en cualquier teléfono o PC
   y toman el color del texto que los rodea. Los mensajes de clientes no se tocan. */
const P = {
  calendario: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  reloj: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  actualizado: '<path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v4.5h-4.5"/>',
  canal: '<path d="M12 12v8.5M9 20.5h6"/><circle cx="12" cy="10" r="1.6"/><path d="M8.2 6.3a5.4 5.4 0 0 0 0 7.4M15.8 6.3a5.4 5.4 0 0 1 0 7.4M5.4 3.7a9.2 9.2 0 0 0 0 12.6M18.6 3.7a9.2 9.2 0 0 1 0 12.6"/>',
  dinero: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.6"/><path d="M6 9.5v5M18 9.5v5"/>',
  bot: '<rect x="4" y="8" width="16" height="11" rx="3"/><path d="M12 4.5V8M2 13v2M22 13v2"/><circle class="lleno" cx="9" cy="13.2" r="1.2"/><circle class="lleno" cx="15" cy="13.2" r="1.2"/>',
  pin: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
  gps: '<circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="1.8"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3"/>',
  enlace: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  lapiz: '<path d="M4 20l1-4.5L15.5 5a2.1 2.1 0 0 1 3 3L8 18.5zM13.5 7l3 3"/>',
  mapa: '<path d="M3 6.5 9 4l6 2.5L21 4v13.5L15 20l-6-2.5L3 20zM9 4v13.5M15 6.5V20"/>',
  telefono: '<path d="M5 3.5h3.5l1.7 4.3-2.2 1.4a11 11 0 0 0 6.8 6.8l1.4-2.2 4.3 1.7V19a1.5 1.5 0 0 1-1.6 1.5A16.5 16.5 0 0 1 3.5 5.1 1.5 1.5 0 0 1 5 3.5z"/>',
  celular: '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
  correo: '<rect x="3" y="5.5" width="18" height="13" rx="2"/><path d="m3.5 7 8.5 6 8.5-6"/>',
  edificio: '<path d="M4 20.5v-15l8-3v18M12 8.5l8 3v9M2.5 20.5h19M7.5 8.5h1M7.5 12h1M7.5 15.5h1M15.5 14h1M15.5 17h1"/>',
  clip: '<path d="m20 11.5-8.1 8.1a5 5 0 0 1-7.1-7.1l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4l7.8-7.8"/>',
  sonrisa: '<circle cx="12" cy="12" r="8.5"/><path d="M8.5 14.2a4.5 4.5 0 0 0 7 0"/><circle class="lleno" cx="9" cy="9.8" r="1.1"/><circle class="lleno" cx="15" cy="9.8" r="1.1"/>',
  rayo: '<path d="M13 2.5 4.5 13.5H11l-1 8 8.5-11H12z"/>',
  papelera: '<path d="M4 6.5h16M9.5 6.5v-2h5v2M6 6.5l1 13.5h10l1-13.5M10 10.5v6M14 10.5v6"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5"/><circle class="lleno" cx="12" cy="7.9" r="1.1"/>',
  estrella: '<path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>',
  regestion: '<path d="M4 12a8 8 0 0 1 13.7-5.7L20 8.5M20 4v4.5h-4.5M20 12a8 8 0 0 1-13.7 5.7L4 15.5M4 20v-4.5h4.5"/>',
  transferir: '<path d="M4 8h14l-3.5-3.5M20 16H6l3.5 3.5"/>',
  seleccionar: '<rect x="3.5" y="3.5" width="17" height="17" rx="3"/><path d="m8 12.3 2.8 2.7 5.5-5.7"/>',
  alerta: '<path d="M12 3.5 2.5 20h19z"/><path d="M12 10v4.5"/><circle class="lleno" cx="12" cy="17.2" r="1.1"/>',
  campana: '<path d="M6 16v-5a6 6 0 1 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  ok: '<circle cx="12" cy="12" r="8.5"/><path d="m8.3 12.3 2.6 2.6 4.9-5.4"/>',
  prohibido: '<circle cx="12" cy="12" r="8.5"/><path d="m6 6 12 12"/>',
  imagen: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="10" r="1.7"/><path d="m20 16-4.5-4.5L6 19.5"/>',
  video: '<rect x="2.5" y="6" width="13.5" height="12" rx="2.5"/><path d="m16 10.5 5.5-3v9l-5.5-3"/>',
  camara: '<path d="M3.5 8.5a2 2 0 0 1 2-2h2.3l1.5-2h5.4l1.5 2h2.3a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/><circle cx="12" cy="12.8" r="3.5"/>',
  audio: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>',
  documento: '<path d="M6 2.5h8L18.5 7v14.5H6zM14 2.5V7h4.5M9 12h6M9 15.5h6"/>',
  carpeta: '<path d="M3 6.5a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  portapapeles: '<rect x="5" y="4.5" width="14" height="16.5" rx="2"/><path d="M9 3h6v3H9z"/>',
  mas: '<circle class="lleno" cx="5.5" cy="12" r="1.5"/><circle class="lleno" cx="12" cy="12" r="1.5"/><circle class="lleno" cx="18.5" cy="12" r="1.5"/>',
  pastel: '<path d="M4 20.5h16v-7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2zM4 15.5c1.3 1 2.7 1 4 0s2.7-1 4 0 2.7 1 4 0 2.7-1 4 0M8 11.5v-3M12 11.5v-3M16 11.5v-3"/>',
  sol: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
  casa: '<path d="M3.5 11 12 4l8.5 7M6 9.5V20h12V9.5"/>',
  escudo: '<path d="m12 3 7.5 3v5.5c0 4.5-3.2 8-7.5 9.5-4.3-1.5-7.5-5-7.5-9.5V6z"/>',
  mensaje: '<path d="M4 5.5h16v11H9l-5 4z"/>',
  usuarios: '<circle cx="9" cy="8.5" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 5.2a3.5 3.5 0 0 1 0 6.6M18 14.5a6.5 6.5 0 0 1 3.5 5.5"/>',
  mas_simple: '<path d="M12 5v14M5 12h14"/>',
  flecha_arriba: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  ajustes: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2.2"/><circle cx="9" cy="17" r="2.2"/>',
  quitar: '<circle cx="12" cy="12" r="8.5"/><path d="m9 9 6 6M15 9l-6 6"/>',
  filtro: '<path d="M3.5 5h17l-6.5 8v5.5l-4 2V13z"/>',
  expandir: '<path d="m9 6 6 6-6 6"/>',
  plegar: '<path d="m15 6-6 6 6 6"/>',
  ojo: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  ojo_tachado: '<path d="M10.6 5.6A9.8 9.8 0 0 1 12 5.5C18 5.5 21.5 12 21.5 12a17 17 0 0 1-2.6 3.4M6.2 7.2A16.6 16.6 0 0 0 2.5 12S6 18.5 12 18.5a9.6 9.6 0 0 0 4.4-1.1M9.9 9.9a3 3 0 0 0 4.2 4.2M3 3l18 18"/>',
  responder: '<path d="M9 7 4 12l5 5M4 12h10a6 6 0 0 1 6 6"/>'
};

/** Ícono de línea como SVG en línea. `titulo` lo vuelve accesible; si no, es decorativo. */
export function ic(nombre, titulo = '') {
  const d = P[nombre] || P.info;
  return `<svg class="ic ic-${nombre}" viewBox="0 0 24 24" ${titulo ? `role="img" aria-label="${titulo.replace(/"/g, '&quot;')}"` : 'aria-hidden="true"'} focusable="false">${d}</svg>`;
}
export const ICONOS_DISPONIBLES = Object.keys(P);
/** Ícono según el tono de un aviso. */
export const icTono = tono => ic({ ok: 'ok', warn: 'alerta', bad: 'prohibido' }[tono] || 'campana');
