ALTER TABLE negociaciones ADD COLUMN IF NOT EXISTS bot_recepcion JSONB NOT NULL DEFAULT '{}';
-- La recepción estructurada de IMPAR no necesita una clave de IA.
UPDATE empresas SET flags=flags || '{"bot":true,"respuestasRapidas":true,"adjuntos":true,"botAutoOff":true,"antiDuplicado":true}'::jsonb,
 bot=bot || '{"activo":true,"recepcionImpar":true}'::jsonb WHERE codigo='impar';
