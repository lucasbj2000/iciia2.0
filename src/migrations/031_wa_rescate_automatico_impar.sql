-- IMPAR: rescate automático de mensajes que el cliente no pudo descifrar («Esperando mensaje»).
-- Aditiva e idempotente.
ALTER TABLE wa_entregas_impar ADD COLUMN IF NOT EXISTS leido_ts TIMESTAMPTZ;
ALTER TABLE wa_entregas_impar ADD COLUMN IF NOT EXISTS rescate TEXT;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='wa_entregas_impar_rescate_chk' AND conrelid='wa_entregas_impar'::regclass) THEN
    ALTER TABLE wa_entregas_impar ADD CONSTRAINT wa_entregas_impar_rescate_chk
      CHECK (rescate IS NULL OR rescate IN ('reenviado','sin_alternativa','agotado'));
  END IF;
END $$;
-- Un reenvío se reconoce por el mensaje de origen: nunca se reenvía un reenvío (sin rebotes).
ALTER TABLE outbox ADD COLUMN IF NOT EXISTS reenvio_de BIGINT REFERENCES outbox(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_wa_entregas_impar_rescate ON wa_entregas_impar(reintento_ts)
  WHERE reintentos>0 AND reenviado_ts IS NULL;
