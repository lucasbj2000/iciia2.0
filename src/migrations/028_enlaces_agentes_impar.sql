-- IMPAR · Enlaces de WhatsApp por agente: clics y negociaciones atribuidas.
-- Aditiva: no modifica contactos, negociaciones existentes, sesiones ni credenciales.
CREATE TABLE IF NOT EXISTS enlaces_clics_impar (
  id          BIGSERIAL PRIMARY KEY,
  empresa_id  UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  usuario_id  UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  ts          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_enlaces_clics_impar ON enlaces_clics_impar(empresa_id, usuario_id, ts DESC);
ALTER TABLE negociaciones ADD COLUMN IF NOT EXISTS enlace_agente_id UUID REFERENCES usuarios(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_neg_enlace_agente_impar ON negociaciones(empresa_id, enlace_agente_id) WHERE enlace_agente_id IS NOT NULL;
