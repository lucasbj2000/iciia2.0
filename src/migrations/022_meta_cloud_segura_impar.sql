-- WhatsApp Cloud API IMPAR · recepción duradera antes de responder 200 a Meta.
CREATE TABLE IF NOT EXISTS meta_webhook_eventos_impar (
 id BIGSERIAL PRIMARY KEY,
 sha256 TEXT NOT NULL UNIQUE,
 objeto TEXT NOT NULL,
 payload JSONB,
 estado TEXT NOT NULL DEFAULT 'pendiente'
   CHECK(estado IN ('pendiente','procesando','procesado','cuarentena')),
 intentos INT NOT NULL DEFAULT 0,
 error TEXT,
 recibido TIMESTAMPTZ NOT NULL DEFAULT now(),
 procesando_desde TIMESTAMPTZ,
 procesado TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_meta_eventos_pendientes_impar
 ON meta_webhook_eventos_impar(estado,recibido) WHERE estado IN ('pendiente','procesando');

ALTER TABLE wa_entregas_impar ADD COLUMN IF NOT EXISTS estado_meta TEXT;
ALTER TABLE wa_entregas_impar ADD COLUMN IF NOT EXISTS error_meta TEXT;
CREATE INDEX IF NOT EXISTS idx_wa_entregas_impar_wa_id ON wa_entregas_impar(empresa_id,wa_id);
