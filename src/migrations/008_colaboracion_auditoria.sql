CREATE TABLE IF NOT EXISTS notas_internas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  negociacion_id UUID NOT NULL REFERENCES negociaciones(id) ON DELETE CASCADE,
  autor_id UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  autor_nombre TEXT NOT NULL,
  texto TEXT NOT NULL,
  menciones UUID[] NOT NULL DEFAULT '{}',
  ts TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notas_neg ON notas_internas(empresa_id,negociacion_id,ts);
CREATE TABLE IF NOT EXISTS registro_cambios (
  id BIGSERIAL PRIMARY KEY,
  empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  entidad TEXT NOT NULL,
  entidad_id UUID NOT NULL,
  operacion TEXT NOT NULL,
  campo TEXT NOT NULL,
  anterior JSONB,
  nuevo JSONB,
  usuario TEXT NOT NULL,
  usuario_id UUID,
  ip TEXT,
  ts TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cambios_emp ON registro_cambios(empresa_id,id DESC);
CREATE INDEX IF NOT EXISTS idx_cambios_entidad ON registro_cambios(empresa_id,entidad,entidad_id,id DESC);

CREATE OR REPLACE FUNCTION impar_registrar_cambio() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  previo JSONB; actual JSONB; fila JSONB; clave TEXT; claves TEXT[]; resumen JSONB := '{}';
  actor TEXT := COALESCE(NULLIF(current_setting('impar.actor',true),''),'Sistema');
  actor_id UUID := NULLIF(current_setting('impar.actor_id',true),'')::UUID;
  actor_ip TEXT := NULLIF(current_setting('impar.ip',true),'');
BEGIN
  IF TG_OP <> 'INSERT' THEN previo := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN actual := to_jsonb(NEW); END IF;
  fila := COALESCE(actual,previo);
  IF fila->>'empresa_id' IS NULL THEN RETURN COALESCE(NEW,OLD); END IF;
  claves := CASE TG_TABLE_NAME
    WHEN 'negociaciones' THEN ARRAY['titulo','etapa','agente_id','sucursal','linea','valor','monto_cierre','motivo','bot_activo']
    WHEN 'contactos' THEN ARRAY['nombre','tel','email','doc','ciudad','direccion','notas','responsable_id','sucursal','linea']
    WHEN 'usuarios' THEN ARRAY['nombre','usuario','rol','cargo','superior_id','equipo','sucursal','linea','email','tel','nacimiento','activo','oculto']
  END;
  IF TG_OP = 'UPDATE' THEN
    FOREACH clave IN ARRAY claves LOOP
      IF previo->clave IS DISTINCT FROM actual->clave THEN
        INSERT INTO registro_cambios(empresa_id,entidad,entidad_id,operacion,campo,anterior,nuevo,usuario,usuario_id,ip)
        VALUES((fila->>'empresa_id')::UUID,TG_TABLE_NAME,(fila->>'id')::UUID,TG_OP,clave,previo->clave,actual->clave,actor,actor_id,actor_ip);
      END IF;
    END LOOP;
    IF TG_TABLE_NAME='usuarios' AND previo->'pass_hash' IS DISTINCT FROM actual->'pass_hash' THEN
      INSERT INTO registro_cambios(empresa_id,entidad,entidad_id,operacion,campo,nuevo,usuario,usuario_id,ip)
      VALUES((fila->>'empresa_id')::UUID,TG_TABLE_NAME,(fila->>'id')::UUID,TG_OP,'contraseña','"Actualizada"'::JSONB,actor,actor_id,actor_ip);
    END IF;
  ELSE
    FOREACH clave IN ARRAY claves LOOP resumen := resumen || jsonb_build_object(clave,fila->clave); END LOOP;
    INSERT INTO registro_cambios(empresa_id,entidad,entidad_id,operacion,campo,anterior,nuevo,usuario,usuario_id,ip)
    VALUES((fila->>'empresa_id')::UUID,TG_TABLE_NAME,(fila->>'id')::UUID,TG_OP,'registro',
      CASE WHEN TG_OP='DELETE' THEN resumen ELSE NULL END,
      CASE WHEN TG_OP='INSERT' THEN resumen ELSE NULL END,actor,actor_id,actor_ip);
  END IF;
  RETURN COALESCE(NEW,OLD);
END;
$$;
DROP TRIGGER IF EXISTS impar_cambios ON contactos;
CREATE TRIGGER impar_cambios AFTER INSERT OR UPDATE OR DELETE ON contactos FOR EACH ROW EXECUTE FUNCTION impar_registrar_cambio();
DROP TRIGGER IF EXISTS impar_cambios ON negociaciones;
CREATE TRIGGER impar_cambios AFTER INSERT OR UPDATE OR DELETE ON negociaciones FOR EACH ROW EXECUTE FUNCTION impar_registrar_cambio();
DROP TRIGGER IF EXISTS impar_cambios ON usuarios;
CREATE TRIGGER impar_cambios AFTER INSERT OR UPDATE OR DELETE ON usuarios FOR EACH ROW EXECUTE FUNCTION impar_registrar_cambio();
