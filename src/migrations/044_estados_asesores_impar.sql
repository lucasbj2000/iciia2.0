-- Tiempos por estado de los asesores y salidas sin marcar.
-- «origen»: manual (el asesor eligió el estado) u olvido (salida cargada al día siguiente, con motivo).
ALTER TABLE marcaciones ADD COLUMN IF NOT EXISTS motivo TEXT;
ALTER TABLE marcaciones ADD COLUMN IF NOT EXISTS origen TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE marcaciones ADD COLUMN IF NOT EXISTS registrada TIMESTAMPTZ NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS idx_marc_emp_ts ON marcaciones(empresa_id, ts);
