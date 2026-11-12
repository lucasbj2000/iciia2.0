-- Llamadas de WhatsApp (Cloud API Calling) en etapa de prueba.
-- Solo los usuarios en "probadores" ven y usan las llamadas; el resto del CRM no cambia.
CREATE TABLE IF NOT EXISTS llamadas_wa_config_impar (
  empresa_id   UUID PRIMARY KEY REFERENCES empresas(id) ON DELETE CASCADE,
  activo       BOOLEAN NOT NULL DEFAULT false,
  probadores   UUID[] NOT NULL DEFAULT '{}',
  canal_id     UUID REFERENCES canales(id) ON DELETE SET NULL,
  actualizado  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS llamadas_wa_impar (
  id              BIGSERIAL PRIMARY KEY,
  empresa_id      UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  canal_id        UUID REFERENCES canales(id) ON DELETE SET NULL,
  call_id         TEXT NOT NULL UNIQUE,
  direccion       TEXT NOT NULL CHECK (direccion IN ('entrante','saliente')),
  telefono        TEXT NOT NULL DEFAULT '',
  contacto_id     UUID REFERENCES contactos(id) ON DELETE SET NULL,
  negociacion_id  UUID REFERENCES negociaciones(id) ON DELETE SET NULL,
  usuario_id      UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  estado          TEXT NOT NULL DEFAULT 'sonando',
  sdp_oferta      TEXT,
  creado          TIMESTAMPTZ NOT NULL DEFAULT now(),
  conectada       TIMESTAMPTZ,
  fin             TIMESTAMPTZ,
  duracion        INTEGER,
  error           TEXT
);
CREATE INDEX IF NOT EXISTS idx_llamadas_wa_empresa ON llamadas_wa_impar(empresa_id, creado DESC);
