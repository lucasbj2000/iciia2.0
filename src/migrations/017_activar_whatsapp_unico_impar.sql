-- IMPAR: única línea WhatsApp compartida de forma automática.
-- Afecta únicamente la configuración de CANALES, sin mover usuarios, clientes,
-- negociaciones ni cambiar sesiones WhatsApp o secretos.
DO $$
DECLARE
  emp UUID;
  elegida UUID;
  n_cent INT;
  n_total INT;
  n_marcadas INT;
BEGIN
  SELECT id INTO emp FROM empresas WHERE codigo='impar' AND activa;
  IF emp IS NULL THEN RETURN; END IF;
  SELECT count(*)::int INTO n_marcadas
    FROM canales WHERE empresa_id=emp AND activo
      AND tipo IN('whatsapp_qr','whatsapp_api')
      AND config->>'principal_global'='true';
  IF n_marcadas>0 THEN
    RAISE NOTICE 'IMPAR: la línea principal ya fue configurada; se mantiene sin cambios';
    RETURN;
  END IF;
  SELECT count(*)::int,min(c.id::text)::uuid INTO n_cent,elegida
    FROM canales c JOIN sucursales s
      ON s.id=c.sucursal_id AND s.empresa_id=c.empresa_id
   WHERE c.empresa_id=emp AND c.activo
     AND c.tipo IN('whatsapp_qr','whatsapp_api')
     AND lower(trim(s.nombre))='central';
  IF n_cent<>1 THEN
    SELECT count(*)::int,min(id::text)::uuid INTO n_total,elegida
      FROM canales WHERE empresa_id=emp AND activo
        AND tipo IN('whatsapp_qr','whatsapp_api');
    IF n_total<>1 THEN
      RAISE NOTICE 'IMPAR: varias líneas posibles; no se seleccionó ninguna automáticamente';
      RETURN;
    END IF;
  END IF;
  UPDATE canales
    SET config=jsonb_set(COALESCE(config,'{}'::jsonb),
          '{principal_global}','true'::jsonb,true)
  WHERE id=elegida AND empresa_id=emp;
  RAISE NOTICE 'IMPAR: se habilitó la única línea WhatsApp de uso compartido';
END $$;
