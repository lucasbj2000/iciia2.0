-- IMPAR: pausa temporal de cualquier respuesta automática hacia clientes.
-- Se conservan números, conversaciones, clientes, agentes y respuestas manuales.
ALTER TABLE outbox ADD COLUMN IF NOT EXISTS automatico BOOLEAN NOT NULL DEFAULT FALSE;

-- Identificar los envíos del bot previamente encolados (no enviados),
-- vinculándolos a mensajes de bot de la misma negociación, texto y momento.
UPDATE outbox o SET automatico=TRUE
WHERE o.estado='pendiente'
  AND o.empresa_id IN (SELECT id FROM empresas WHERE codigo='impar')
  AND EXISTS (
    SELECT 1 FROM mensajes m
    WHERE m.empresa_id=o.empresa_id AND m.negociacion_id=o.negociacion_id
      AND m.bot=TRUE AND m.dir='out' AND m.estado='pendiente'
      AND m.txt IS NOT DISTINCT FROM o.txt
      AND abs(extract(epoch from (m.ts-o.ts))) < 120
  );

-- Bloqueo persistente: apagamos recepción automática y bot de IA.
UPDATE empresas
SET flags=jsonb_set(COALESCE(flags,'{}'::jsonb),'#{bot}','false'::jsonb,TRUE),
    bot=jsonb_set(COALESCE(bot,'{}'::jsonb),'#{activo}','false'::jsonb,TRUE)
WHERE codigo='impar';

-- Cada negociación existente queda manual incluso si después se vuelve a
-- habilitar el bot global. La reactivación debe ser explícita.
UPDATE negociaciones SET bot_activo=FALSE
WHERE empresa_id IN (SELECT id FROM empresas WHERE codigo='impar')
  AND bot_activo=TRUE;

-- No despachar al cliente respuestas automáticas que aún no salieron.
UPDATE outbox SET estado='cancelado',
  error='Respuesta automática suspendida en IMPAR por migración desde CRM anterior'
WHERE automatico=TRUE AND estado='pendiente'
  AND empresa_id IN (SELECT id FROM empresas WHERE codigo='impar');

-- Conservar los mensajes bot como registro, sin falsos indicadores de pendiente.
UPDATE mensajes m SET estado='cancelado'
WHERE m.bot=TRUE AND m.dir='out' AND m.estado='pendiente'
  AND m.empresa_id IN (SELECT id FROM empresas WHERE codigo='impar')
  AND EXISTS (
    SELECT 1 FROM outbox o
    WHERE o.empresa_id=m.empresa_id AND o.negociacion_id=m.negociacion_id
      AND o.automatico=TRUE AND o.estado='cancelado'
      AND o.txt IS NOT DISTINCT FROM m.txt
      AND abs(extract(epoch from (m.ts-o.ts))) < 120
  );
