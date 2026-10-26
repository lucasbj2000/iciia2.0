-- IMPAR: equivalencias oficiales PN-LID observadas en eventos WhatsApp.
-- Siempre comienza enviando por PN. La ruta LID exige activación manual de administrador.
CREATE TABLE IF NOT EXISTS wa_identidades_impar (
  empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  canal_id UUID NOT NULL REFERENCES canales(id) ON DELETE CASCADE,
  pn_jid TEXT NOT NULL,
  lid_jid TEXT NOT NULL,
  fuente TEXT NOT NULL DEFAULT 'evento_whatsapp',
  preferir_lid BOOLEAN NOT NULL DEFAULT FALSE,
  primera_vez TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizada TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (canal_id,pn_jid)
);
CREATE INDEX IF NOT EXISTS idx_wa_id_impar_empresa ON wa_identidades_impar(empresa_id,canal_id,actualizada DESC);
