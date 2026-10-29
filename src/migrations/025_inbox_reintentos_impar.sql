-- IMPAR · Recepción durable: reintentos escalonados de inbox antes de cuarentena.
-- Aditiva: no borra mensajes, contactos, negociaciones, sesiones ni credenciales.
ALTER TABLE inbox ADD COLUMN IF NOT EXISTS proximo_intento TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_inbox_pendiente_proximo
  ON inbox(proximo_intento, ts) WHERE estado='pendiente';

-- Devolver a la cola los mensajes de clientes que quedaron en cuarentena
-- durante los últimos 7 días por fallos transitorios (3 intentos en ~6 s).
-- La ingesta deduplica por el ID real del mensaje, por lo que un mensaje que
-- ya figure en la conversación no se duplica.
UPDATE inbox SET estado='pendiente', intentos=0, proximo_intento=NULL,
       error='Recuperado de cuarentena por migración 025: ' || COALESCE(error,'')
 WHERE estado='cuarentena' AND ts > now() - interval '7 days';
