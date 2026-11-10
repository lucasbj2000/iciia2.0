-- IMPAR: si Meta rechaza un mensaje de la línea verificada por la ventana de 24 h (131047),
-- el CRM lo reenvía solo por la línea normal. Aditiva e idempotente.
-- El intento rechazado queda guardado (auditoría) y apunta al mensaje que lo reemplazó:
-- los agentes ven solo el mensaje entregado; administración ve ambos.
ALTER TABLE mensajes ADD COLUMN IF NOT EXISTS reemplazado_por BIGINT REFERENCES mensajes(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_mensajes_reemplazado ON mensajes(reemplazado_por) WHERE reemplazado_por IS NOT NULL;
ALTER TABLE wa_entregas_impar DROP CONSTRAINT IF EXISTS wa_entregas_impar_rescate_chk;
ALTER TABLE wa_entregas_impar ADD CONSTRAINT wa_entregas_impar_rescate_chk
  CHECK (rescate IS NULL OR rescate IN ('reenviado','sin_alternativa','agotado','linea_normal','sin_linea_normal'));
