-- IMPAR · Soporte interno del CRM.
-- Flujo: el usuario envía (consulta / falla / mejora) → un gerente aprobador
-- da la primera aprobación → administración confirma si se hace o no → resuelta.
-- Idempotente: puede ejecutarse más de una vez sin efectos.

CREATE TABLE IF NOT EXISTS soporte_config (
  empresa_id   UUID PRIMARY KEY REFERENCES empresas(id) ON DELETE CASCADE,
  aprobadores  UUID[] NOT NULL DEFAULT '{}',   -- gerentes elegidos por el admin
  observadores UUID[] NOT NULL DEFAULT '{}',   -- usuarios que pueden ver todas (solo lectura)
  actualizado  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS soporte_solicitudes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  numero          BIGSERIAL,
  empresa_id      UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  autor_id        UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  tipo            TEXT NOT NULL CHECK (tipo IN ('consulta','falla','mejora')),
  titulo          TEXT NOT NULL,
  descripcion     TEXT NOT NULL DEFAULT '',
  modulo          TEXT NOT NULL DEFAULT 'otro',
  impacto         TEXT NOT NULL DEFAULT 'medio' CHECK (impacto IN ('bajo','medio','alto')),
  estado          TEXT NOT NULL DEFAULT 'gerencia'
                  CHECK (estado IN ('gerencia','administracion','aprobada','resuelta','rechazada')),
  archivo         JSONB,
  contexto        JSONB NOT NULL DEFAULT '{}'::jsonb,
  gerente_id      UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  gerente_ts      TIMESTAMPTZ,
  admin_id        UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  admin_ts        TIMESTAMPTZ,
  rechazo_etapa   TEXT,
  resuelta_ts     TIMESTAMPTZ,
  creado          TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS soporte_sol_empresa_estado ON soporte_solicitudes (empresa_id, estado, creado DESC);
CREATE INDEX IF NOT EXISTS soporte_sol_autor ON soporte_solicitudes (autor_id, creado DESC);

CREATE TABLE IF NOT EXISTS soporte_eventos (
  id            BIGSERIAL PRIMARY KEY,
  solicitud_id  UUID NOT NULL REFERENCES soporte_solicitudes(id) ON DELETE CASCADE,
  usuario_id    UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  tipo          TEXT NOT NULL,          -- creada | aprobada_gerencia | rechazada | confirmada | resuelta | comentario
  texto         TEXT NOT NULL DEFAULT '',
  ts            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS soporte_eventos_sol ON soporte_eventos (solicitud_id, ts);
