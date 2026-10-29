# IMPAR · Mensajes no descifrables y reintentos de recepción · Protocolo 002

## Diagnóstico en producción (29/10/2026)

- `reporte-recepcion-impar.mjs`: 520 capturados, 520 en conversación, 0 en cuarentena.
  Corte sin mensajes entre 16:00 y 17:00; tras desplegar `a008770` se recuperaron 50
  mensajes escritos en ese intervalo.
- `[wa:recepcion]`: `guardados=162`, `sin_contenido=206`. Logs: 1641 líneas
  `failed to decrypt` / `Bad MAC` / `No session`.
- Conclusión: la pérdida ocurre antes de `inbox`. WhatsApp entrega el mensaje cifrado,
  la sesión Signal no lo descifra y Baileys solicita el reenvío. Si el reenvío no llega,
  el mensaje se descartaba sin rastro.

## Cambios

1. `src/channels/baileys.mjs`: un mensaje `CIPHERTEXT` espera 60 s
   (`WA_ESPERA_DESCIFRADO_MS`) el reenvío. Si no llega, se registra en `inbox` con el aviso
   «El cliente envió un mensaje que WhatsApp no permitió leer en el CRM. Pedile que lo
   reenvíe.» y sigue el flujo normal: ficha, negociación, agente y notificación.
   Si el original llega después, reemplaza el aviso en `inbox` y en la conversación
   (mismo ID, sin duplicar) y descarga el adjunto si lo tiene.
   El log suma `recuperados`, `avisos_no_leidos`, `tardios` y `esperando_descifrado`.
2. `src/worker.mjs`: 10 intentos escalonados (5 s a 30 min, ~70 min) antes de cuarentena.
3. Migración `025_inbox_reintentos_impar.sql` (aditiva): `inbox.proximo_intento`, índice
   parcial y devolución a la cola de la cuarentena de los últimos 7 días.
4. Panel Mensajería y reporte muestran reintentos y cuarentena.

No se tocan `auth/`, `media/`, `.env`, credenciales ni sesiones Signal.

## Límites

- No resuelve la causa de que la sesión Signal falle: solo evita que el mensaje quede invisible.
  El texto de un mensaje que WhatsApp nunca reenvía no puede recuperarse.
- Los avisos dependen de un temporizador en memoria: un reinicio de PM2 durante los 60 s
  de espera omite el aviso de esos mensajes.
- Un número nuevo cuyo primer mensaje sea un aviso recibe la bienvenida del bot normalmente.

## Verificación

`node scripts/test-wa-no-descifrados-impar.mjs`, `node scripts/test-inbox-reintentos-impar.mjs`,
`node scripts/test-recepcion-baileys-buffer-impar.mjs` y la suite de `actualizar.sh`.

Después del despliegue:
```bash
pm2 logs iciia-crm --lines 200 --nostream | grep "wa:recepcion" | tail -3
```
`recuperados` + `avisos_no_leidos` debe acompañar el aumento de `sin_contenido`.
En el CRM, los avisos aparecen como mensajes del cliente en su conversación.

## Reversión

Revertir el commit en GitHub y desplegar con `bash scripts/actualizar.sh`. La columna
`proximo_intento` puede permanecer. Los avisos ya registrados quedan como mensajes del historial.
