-- IMPAR: teléfonos adicionales de un cliente, sin fusionar contactos existentes.
-- Regla: un número pertenece a un solo contacto dentro de IMPAR.
-- Los números primarios existentes que estén repetidos se dejan intactos:
-- no se adivinan identidades ni se mezclan historiales.
CREATE TABLE IF NOT EXISTS contacto_telefonos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  contacto_id UUID NOT NULL REFERENCES contactos(id) ON DELETE CASCADE,
  numero TEXT NOT NULL,
  tel_norm TEXT NOT NULL,
  etiqueta TEXT NOT NULL DEFAULT 'Secundario',
  creado TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT tel_secundario_valido CHECK (length(tel_norm)=8)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_impar_telefono_secundario
  ON contacto_telefonos(empresa_id,tel_norm);
CREATE INDEX IF NOT EXISTS idx_impar_telefonos_contacto
  ON contacto_telefonos(empresa_id,contacto_id);
ALTER TABLE negociaciones ADD COLUMN IF NOT EXISTS telefono_destino TEXT;

-- Registrar los primarios que tienen una sola coincidencia; dejar cualquier
-- conflicto preexistente SIN tocar y sin bloquear el arranque del CRM.
INSERT INTO contacto_telefonos (empresa_id,contacto_id,numero,tel_norm,etiqueta)
SELECT c.empresa_id,c.id,c.tel,c.tel_norm,'Principal'
FROM contactos c
WHERE length(c.tel_norm)=8
  AND length(regexp_replace(c.tel,'[^0-9]','','g')) BETWEEN 10 AND 15
  AND (SELECT count(*) FROM contactos o
       WHERE o.empresa_id=c.empresa_id AND o.tel_norm=c.tel_norm)=1
ON CONFLICT (empresa_id,tel_norm) DO NOTHING;
