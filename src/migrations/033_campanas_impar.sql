-- Campañas masivas por WhatsApp Cloud API (número verificado) con plantillas aprobadas por Meta.
-- Solo crea tablas nuevas: no modifica ni borra datos existentes.

-- Quién puede usar Campañas. Admin siempre; gerentes por defecto salvo que se les quite;
-- cualquier otro usuario solo si se le da acceso explícito.
CREATE TABLE IF NOT EXISTS campanas_accesos (
  empresa_id  UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  usuario_id  UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  permitido   BOOLEAN NOT NULL,
  actualizado TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa_id, usuario_id)
);

CREATE TABLE IF NOT EXISTS campanas (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  canal_id      UUID REFERENCES canales(id) ON DELETE SET NULL,
  nombre        TEXT NOT NULL,
  plantilla     JSONB NOT NULL,
  variables     JSONB NOT NULL DEFAULT '{}'::jsonb,
  estado        TEXT NOT NULL DEFAULT 'borrador'
                CHECK (estado IN ('borrador','enviando','pausada','terminada','cancelada')),
  limite_diario INT NOT NULL DEFAULT 250 CHECK (limite_diario BETWEEN 1 AND 100000),
  creado_por    UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  creado        TIMESTAMPTZ NOT NULL DEFAULT now(),
  iniciado      TIMESTAMPTZ,
  terminado     TIMESTAMPTZ,
  error         TEXT
);
CREATE INDEX IF NOT EXISTS campanas_empresa_idx ON campanas (empresa_id, creado DESC);

CREATE TABLE IF NOT EXISTS campana_destinos (
  id          BIGSERIAL PRIMARY KEY,
  campana_id  UUID NOT NULL REFERENCES campanas(id) ON DELETE CASCADE,
  empresa_id  UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  telefono    TEXT NOT NULL,
  nombre      TEXT,
  contacto_id UUID REFERENCES contactos(id) ON DELETE SET NULL,
  datos       JSONB NOT NULL DEFAULT '{}'::jsonb,
  estado      TEXT NOT NULL DEFAULT 'pendiente'
              CHECK (estado IN ('pendiente','enviado','entregado','leido','fallido','omitido')),
  wa_id       TEXT,
  error       TEXT,
  enviado     TIMESTAMPTZ,
  respondio   TIMESTAMPTZ,
  actualizado TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (campana_id, telefono)
);
CREATE INDEX IF NOT EXISTS campana_destinos_estado_idx ON campana_destinos (campana_id, estado, id);
CREATE UNIQUE INDEX IF NOT EXISTS campana_destinos_wa_idx ON campana_destinos (wa_id) WHERE wa_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS campana_destinos_tel_idx ON campana_destinos (empresa_id, telefono, enviado DESC);

-- Clientes que pidieron no recibir campañas (respondieron «BAJA» o los cargó un usuario).
CREATE TABLE IF NOT EXISTS campanas_bajas (
  empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  telefono   TEXT NOT NULL,
  origen     TEXT NOT NULL DEFAULT 'cliente',
  creado     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa_id, telefono)
);
