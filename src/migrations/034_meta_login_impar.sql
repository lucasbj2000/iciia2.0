-- IMPAR · «Conectar con Facebook» (Facebook Login for Business) para Messenger e Instagram.
-- La configuración (ID de configuración de Meta, no es secreto) se carga desde Administración → Canales.
CREATE TABLE IF NOT EXISTS meta_login_ajustes (
  empresa_id  UUID PRIMARY KEY REFERENCES empresas(id) ON DELETE CASCADE,
  config_id   TEXT NOT NULL DEFAULT '',
  actualizado TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Un intento de inicio de sesión: dura 15 minutos y se usa una sola vez.
-- Los tokens de página quedan cifrados y nunca se devuelven al navegador.
CREATE TABLE IF NOT EXISTS meta_login_estados (
  state       TEXT PRIMARY KEY,
  empresa_id  UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  usuario_id  UUID,
  estado      TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','listo','error','usado')),
  error       TEXT,
  paginas     JSONB NOT NULL DEFAULT '[]',
  creado      TIMESTAMPTZ NOT NULL DEFAULT now(),
  vence       TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS meta_login_estados_vence ON meta_login_estados(vence);
