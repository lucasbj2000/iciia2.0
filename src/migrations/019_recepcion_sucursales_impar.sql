-- Activación autorizada: sólo las altas nuevas posteriores a esta actualización.
-- Las fichas, responsables y conversaciones existentes conservan sus datos.
ALTER TABLE negociaciones ADD COLUMN IF NOT EXISTS recepcion_vence TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_recepcion_vence ON negociaciones(recepcion_vence)
  WHERE recepcion_vence IS NOT NULL AND bot_activo AND agente_id IS NULL;
-- No reactivar conversaciones anteriores ni enviar su cola automática antigua.
UPDATE negociaciones n SET bot_activo=FALSE,recepcion_vence=NULL
  FROM empresas e WHERE e.id=n.empresa_id AND e.codigo='impar';
UPDATE outbox o SET estado='cancelado',error='Recepción nueva: conversación anterior en modo manual'
  FROM empresas e WHERE e.id=o.empresa_id AND e.codigo='impar'
  AND o.automatico=TRUE AND o.estado IN ('pendiente','error');
UPDATE mensajes m SET estado='cancelado' FROM empresas e
  WHERE e.id=m.empresa_id AND e.codigo='impar' AND m.bot=TRUE AND m.dir='out'
  AND m.estado IN ('pendiente','error');
UPDATE empresas SET flags=COALESCE(flags,'{}'::jsonb)||'{"bot":true,"botAutoOff":true}'::jsonb,
  bot=COALESCE(bot,'{}'::jsonb)||'{"activo":true,"recepcionImpar":true}'::jsonb
  WHERE codigo='impar';
