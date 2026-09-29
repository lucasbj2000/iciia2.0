-- ============================================================
-- iciia2.0 · Una negociación cerrada no se reabre nunca
-- Protege los reportes (ganadas y cerradas) a nivel base de datos.
-- ============================================================
CREATE OR REPLACE FUNCTION iciia_no_reabrir() RETURNS trigger AS $$
BEGIN
  IF OLD.etapa IN ('ganado', 'cerrado') AND NEW.etapa IS DISTINCT FROM OLD.etapa THEN
    RAISE EXCEPTION 'Una negociación cerrada no se puede reabrir'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_no_reabrir ON negociaciones;
CREATE TRIGGER trg_no_reabrir
  BEFORE UPDATE OF etapa ON negociaciones
  FOR EACH ROW EXECUTE FUNCTION iciia_no_reabrir();
