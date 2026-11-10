/* IMPAR · Piezas de los gráficos con el lenguaje de la empresa: papel e imprenta.
   Las barras son hojas con la esquina doblada, los puntos son marcas de registro y los anillos llevan
   las cruces de registro de un pliego. Colores: verde IMPAR, gris del logo y cian de proceso. */
const n = v => Number(v).toFixed(1);

/** Barra vertical como hoja de papel con la esquina superior derecha doblada. */
export function hoja(x, y, w, h, clase = '', extra = '') {
  if (!(h > 0) || !(w > 0)) return '';
  const f = Math.min(w * 0.5, h, 8);
  return `<g class="hoja ${clase}"${extra}><path class="hoja-c" d="M${n(x)} ${n(y + h)}V${n(y)}H${n(x + w - f)}L${n(x + w)} ${n(y + f)}V${n(y + h)}Z"/>`
    + `<path class="hoja-p" d="M${n(x + w - f)} ${n(y)}V${n(y + f)}H${n(x + w)}Z"/></g>`;
}

/** Punto de dato como marca de registro (círculo con cruz). */
export function registro(cx, cy, r = 4.5, clase = '') {
  const l = r + 3.5;
  return `<g class="registro ${clase}"><circle cx="${n(cx)}" cy="${n(cy)}" r="${r}"/>`
    + `<path d="M${n(cx - l)} ${n(cy)}H${n(cx + l)}M${n(cx)} ${n(cy - l)}V${n(cy + l)}"/></g>`;
}

/** Cruces de registro alrededor de un anillo de radio r centrado en (c, c). */
export function crucesAnillo(c, r) {
  const a = r + 6, b = r + 13;
  return `<path class="anillo-cruz" d="M${c} ${c - a}V${c - b}M${c} ${c + a}V${c + b}M${c - a} ${c}H${c - b}M${c + a} ${c}H${c + b}"/>`;
}
