-- IMPAR · seguimiento interno del proyecto CRM
-- Migración aditiva: conserva todas las tablas y registros existentes.
CREATE TABLE IF NOT EXISTS proyecto_accesos (
  empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  creado TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa_id, usuario_id)
);

CREATE TABLE IF NOT EXISTS proyecto_fases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  nombre TEXT NOT NULL,
  descripcion TEXT NOT NULL DEFAULT '',
  orden INTEGER NOT NULL DEFAULT 0,
  creado TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_proyecto_fases_empresa ON proyecto_fases (empresa_id, orden, creado);

CREATE TABLE IF NOT EXISTS proyecto_pasos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  fase_id UUID NOT NULL REFERENCES proyecto_fases(id) ON DELETE CASCADE,
  titulo TEXT NOT NULL,
  detalle TEXT NOT NULL DEFAULT '',
  tipo TEXT NOT NULL DEFAULT 'tarea' CHECK (tipo IN ('tarea', 'necesidad')),
  porcentaje SMALLINT NOT NULL DEFAULT 0 CHECK (porcentaje BETWEEN 0 AND 100),
  responsable_id UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  vence DATE,
  orden INTEGER NOT NULL DEFAULT 0,
  creado TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_proyecto_pasos_fase ON proyecto_pasos (empresa_id, fase_id, orden);

CREATE TABLE IF NOT EXISTS proyecto_comentarios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  fase_id UUID REFERENCES proyecto_fases(id) ON DELETE CASCADE,
  usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  texto TEXT NOT NULL,
  creado TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_proyecto_comentarios_empresa ON proyecto_comentarios (empresa_id, creado DESC);

-- BYTEA impide servir documentos privados por la ruta pública /media.
-- La descarga solo se realiza tras comprobar permisos en el API autenticado.
CREATE TABLE IF NOT EXISTS proyecto_documentos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  fase_id UUID REFERENCES proyecto_fases(id) ON DELETE SET NULL,
  usuario_id UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  nombre TEXT NOT NULL,
  mime TEXT NOT NULL,
  bytes INTEGER NOT NULL CHECK (bytes > 0 AND bytes <= 10485760),
  contenido BYTEA NOT NULL,
  creado TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_proyecto_documentos_empresa ON proyecto_documentos (empresa_id, creado DESC);
