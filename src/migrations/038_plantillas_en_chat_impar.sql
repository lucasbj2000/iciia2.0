-- IMPAR: las plantillas enviadas por campañas se ven en la conversación del cliente.
ALTER TABLE campana_destinos ADD COLUMN IF NOT EXISTS texto TEXT;
ALTER TABLE mensajes DROP CONSTRAINT IF EXISTS mensajes_especial_chk;
ALTER TABLE mensajes ADD CONSTRAINT mensajes_especial_chk
  CHECK (especial IS NULL OR especial IN ('reaccion','sistema','llamada','no_admitido','plantilla'));
