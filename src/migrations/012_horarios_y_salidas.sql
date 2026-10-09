-- IMPAR · horarios laborales y decisiones de salida. Migración aditiva.
CREATE TABLE IF NOT EXISTS horarios_empresa (
 empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
 dia SMALLINT NOT NULL CHECK(dia BETWEEN 0 AND 6),
 activo BOOLEAN NOT NULL DEFAULT TRUE,
 entrada TIME NOT NULL DEFAULT '08:00',
 salida TIME NOT NULL DEFAULT '17:00',
 actualizado TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(empresa_id,dia),
 CONSTRAINT turno_empresa_valido CHECK (entrada < salida)
);

CREATE TABLE IF NOT EXISTS horarios_agentes (
 empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
 usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
 dia SMALLINT NOT NULL CHECK(dia BETWEEN 0 AND 6),
 activo BOOLEAN NOT NULL DEFAULT TRUE,
 entrada TIME NOT NULL DEFAULT '08:00',
 salida TIME NOT NULL DEFAULT '17:00',
 actualizado TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(empresa_id,usuario_id,dia),
 CONSTRAINT turno_agente_valido CHECK (entrada < salida)
);
CREATE INDEX IF NOT EXISTS idx_horarios_agente ON horarios_agentes(empresa_id,usuario_id);

CREATE TABLE IF NOT EXISTS horarios_respuestas (
 empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
 usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
 dia_fecha DATE NOT NULL,
 decision TEXT NOT NULL CHECK(decision IN ('normal','extra')),
 hasta TIME,
 confirmado_para TIME NOT NULL,
 actualizado TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY (empresa_id,usuario_id,dia_fecha),
 CONSTRAINT respuesta_extra_hora CHECK (
  (decision='normal' AND hasta IS NULL) OR (decision='extra' AND hasta IS NOT NULL)
 )
);
CREATE INDEX IF NOT EXISTS idx_horarios_respuestas_dia ON horarios_respuestas(empresa_id,dia_fecha);

-- La configuración puede editarse posteriormente: estos horarios son valores iniciales.
INSERT INTO horarios_empresa (empresa_id,dia,activo,entrada,salida)
SELECT e.id,d.dia,d.dia BETWEEN 1 AND 5,'08:00','17:00'
FROM empresas e CROSS JOIN generate_series(0,6) AS d(dia)
WHERE e.codigo='impar'
ON CONFLICT DO NOTHING;
