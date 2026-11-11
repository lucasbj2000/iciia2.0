-- ============================================================
-- IMPAR · un número = una sola ficha, en cualquier tabla y formato
-- ============================================================
-- La clave del teléfono se calcula siempre en la base (últimos 8 dígitos), sea
-- cual sea la pantalla, importación o canal que guarde el contacto, y un número
-- no puede ser principal de una ficha y secundario de otra.
-- Las fichas repetidas que ya existan las une el barrido al iniciar
-- (src/duplicados-impar.mjs); este archivo solo bloquea lo nuevo.

CREATE OR REPLACE FUNCTION impar_contacto_tel() RETURNS trigger AS $$
DECLARE d TEXT;
BEGIN
  IF TG_OP = 'INSERT' OR NEW.tel IS DISTINCT FROM OLD.tel THEN
    d := regexp_replace(COALESCE(NEW.tel,''), '\D', '', 'g');
    NEW.tel_norm := CASE WHEN d = '' THEN '' ELSE right(d, 8) END;
  END IF;
  IF COALESCE(NEW.tel_norm,'') <> '' AND (TG_OP = 'INSERT' OR NEW.tel_norm IS DISTINCT FROM OLD.tel_norm) THEN
    IF EXISTS (SELECT 1 FROM contacto_telefonos t
                WHERE t.empresa_id = NEW.empresa_id AND t.tel_norm = NEW.tel_norm AND t.contacto_id <> NEW.id) THEN
      RAISE EXCEPTION 'telefono_duplicado: el número ya pertenece a otro cliente' USING ERRCODE = '23505';
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_impar_contacto_tel ON contactos;
CREATE TRIGGER trg_impar_contacto_tel BEFORE INSERT OR UPDATE OF tel, tel_norm ON contactos
  FOR EACH ROW EXECUTE FUNCTION impar_contacto_tel();

CREATE OR REPLACE FUNCTION impar_telefono_secundario() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM contactos c
              WHERE c.empresa_id = NEW.empresa_id AND c.tel_norm = NEW.tel_norm AND c.id <> NEW.contacto_id) THEN
    RAISE EXCEPTION 'telefono_duplicado: el número ya pertenece a otro cliente' USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_impar_telefono_secundario ON contacto_telefonos;
CREATE TRIGGER trg_impar_telefono_secundario BEFORE INSERT OR UPDATE OF tel_norm, contacto_id ON contacto_telefonos
  FOR EACH ROW EXECUTE FUNCTION impar_telefono_secundario();

-- Identidades de Messenger, Instagram y el @lid de WhatsApp: una ficha por identidad.
-- Si ya hubiera repetidos, el índice se crea en el próximo inicio, después del barrido.
DO $$
DECLARE k TEXT;
BEGIN
  FOREACH k IN ARRAY ARRAY['messenger','instagram','whatsapp_lid'] LOOP
    IF NOT EXISTS (SELECT 1 FROM contactos WHERE externos ? k
                    GROUP BY empresa_id, externos->>k HAVING count(*) > 1) THEN
      EXECUTE format('CREATE UNIQUE INDEX IF NOT EXISTS idx_contacto_externo_%s ON contactos (empresa_id, (externos->>%L)) WHERE externos ? %L', k, k, k);
    END IF;
  END LOOP;
END $$;
