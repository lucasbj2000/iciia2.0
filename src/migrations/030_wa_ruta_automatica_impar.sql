-- IMPAR: ruta de envío WhatsApp automática (número o LID) por contacto.
-- Motivo: cuando WhatsApp migra un contacto a LID, los mensajes enviados al
-- número pueden quedar en el teléfono del cliente como «Esperando mensaje».
-- Aditiva e idempotente: no modifica mensajes, contactos ni sesiones.

ALTER TABLE wa_identidades_impar ADD COLUMN IF NOT EXISTS ruta TEXT NOT NULL DEFAULT 'auto';
ALTER TABLE wa_identidades_impar ADD COLUMN IF NOT EXISTS modo_entrante TEXT;
ALTER TABLE wa_identidades_impar ADD COLUMN IF NOT EXISTS modo_ts TIMESTAMPTZ;
ALTER TABLE wa_identidades_impar ADD COLUMN IF NOT EXISTS fallos_pn INT NOT NULL DEFAULT 0;
ALTER TABLE wa_identidades_impar ADD COLUMN IF NOT EXISTS fallos_lid INT NOT NULL DEFAULT 0;
ALTER TABLE wa_identidades_impar ADD COLUMN IF NOT EXISTS fallo_ts TIMESTAMPTZ;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='wa_identidades_impar_ruta_chk') THEN
    ALTER TABLE wa_identidades_impar ADD CONSTRAINT wa_identidades_impar_ruta_chk CHECK (ruta IN ('auto','pn','lid'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='wa_identidades_impar_modo_chk') THEN
    ALTER TABLE wa_identidades_impar ADD CONSTRAINT wa_identidades_impar_modo_chk CHECK (modo_entrante IS NULL OR modo_entrante IN ('pn','lid'));
  END IF;
END $$;

-- Quien ya había activado LID a mano lo conserva como elección fija.
UPDATE wa_identidades_impar SET ruta='lid' WHERE preferir_lid AND ruta='auto';

CREATE INDEX IF NOT EXISTS idx_wa_id_impar_lid ON wa_identidades_impar(canal_id,lid_jid);

-- Avisos de «no pude descifrar» (retry) por mensaje enviado.
ALTER TABLE wa_entregas_impar ADD COLUMN IF NOT EXISTS reintentos INT NOT NULL DEFAULT 0;
ALTER TABLE wa_entregas_impar ADD COLUMN IF NOT EXISTS reintento_ts TIMESTAMPTZ;
ALTER TABLE wa_entregas_impar ADD COLUMN IF NOT EXISTS reenviado_ts TIMESTAMPTZ;
