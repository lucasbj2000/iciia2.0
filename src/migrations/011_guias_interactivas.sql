-- IMPAR · ayuda contextual configurable por administración (aditiva).
CREATE TABLE IF NOT EXISTS guia_configuracion (
  empresa_id UUID PRIMARY KEY REFERENCES empresas(id) ON DELETE CASCADE,
  general BOOLEAN NOT NULL DEFAULT FALSE,
  mini_ayudas BOOLEAN NOT NULL DEFAULT TRUE,
  bienvenida BOOLEAN NOT NULL DEFAULT TRUE,
  actualizado TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS guia_preferencias (
  empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  modo TEXT NOT NULL DEFAULT 'heredar' CHECK (modo IN ('heredar','mostrar','ocultar')),
  recorrido_visto BOOLEAN NOT NULL DEFAULT FALSE,
  actualizado TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (empresa_id, usuario_id)
);
CREATE INDEX IF NOT EXISTS idx_guia_preferencias_empresa
  ON guia_preferencias (empresa_id, modo);
