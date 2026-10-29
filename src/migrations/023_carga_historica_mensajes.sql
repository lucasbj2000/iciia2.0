-- IMPAR: mensajes históricos añadidos por administrador sin simular recepción o envío real.
ALTER TABLE mensajes ADD COLUMN IF NOT EXISTS carga_historica BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE mensajes ADD COLUMN IF NOT EXISTS carga_por UUID REFERENCES usuarios(id) ON DELETE SET NULL;
ALTER TABLE mensajes ADD COLUMN IF NOT EXISTS carga_registrada TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_msg_historicos_impar
 ON mensajes(empresa_id,negociacion_id,ts,id) WHERE carga_historica=TRUE;
