-- Pasarela telefónica (celular con chip + Linux por Bluetooth), en etapa de prueba.
-- La pasarela se conecta al CRM con un token propio; el token se guarda solo como hash.
CREATE TABLE IF NOT EXISTS pasarelas_tel_impar (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id       UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  nombre           TEXT NOT NULL DEFAULT 'Pasarela telefónica',
  sucursal         TEXT,
  token_hash       TEXT NOT NULL UNIQUE,
  crear_negociacion BOOLEAN NOT NULL DEFAULT true,
  activo           BOOLEAN NOT NULL DEFAULT true,
  creado           TIMESTAMPTZ NOT NULL DEFAULT now(),
  ultimo_contacto  TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pasarela_tel_empresa ON pasarelas_tel_impar(empresa_id);

-- Las llamadas por teléfono usan el mismo historial que las de WhatsApp.
ALTER TABLE llamadas_wa_impar ADD COLUMN IF NOT EXISTS medio TEXT NOT NULL DEFAULT 'whatsapp';
ALTER TABLE llamadas_wa_impar ADD COLUMN IF NOT EXISTS pasarela_id UUID REFERENCES pasarelas_tel_impar(id) ON DELETE SET NULL;
