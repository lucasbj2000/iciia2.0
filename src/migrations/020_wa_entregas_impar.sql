-- IMPAR: acuses de entrega WhatsApp asociados al identificador real de Baileys.
-- Migration aditiva: no modifica mensajes históricos, contactos, credenciales ni conversaciones.
ALTER TABLE outbox ADD COLUMN IF NOT EXISTS mensaje_id BIGINT REFERENCES mensajes(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_outbox_mensaje_impar ON outbox(mensaje_id) WHERE mensaje_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS wa_entregas_impar (
  canal_id UUID NOT NULL REFERENCES canales(id) ON DELETE CASCADE,
  wa_id TEXT NOT NULL,
  empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  outbox_id BIGINT REFERENCES outbox(id) ON DELETE SET NULL,
  ack SMALLINT NOT NULL DEFAULT 2 CHECK (ack BETWEEN 0 AND 5),
  jid_tipo TEXT DEFAULT '',
  creado TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(canal_id,wa_id)
);
CREATE INDEX IF NOT EXISTS idx_wa_entregas_impar_outbox ON wa_entregas_impar(outbox_id);
CREATE INDEX IF NOT EXISTS idx_wa_entregas_impar_est ON wa_entregas_impar(empresa_id,ack,actualizado);
