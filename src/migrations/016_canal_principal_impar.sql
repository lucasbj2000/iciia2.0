-- IMPAR: canal de Central "principal" compartido por empleados de todas las sucursales.
-- No mueve usuarios, clientes, negociaciones ni sesiones WhatsApp existentes.
-- Sólo marca el canal real indicado en Administración → Canales.
DO $$
DECLARE
  canal UUID;
  cantidad INT;
BEGIN
  SELECT count(*)::int, min(c.id::text)::uuid INTO cantidad, canal
    FROM canales c
    JOIN sucursales s ON s.id=c.sucursal_id AND s.empresa_id=c.empresa_id
    JOIN empresas e ON e.id=c.empresa_id
   WHERE e.codigo='impar'
     AND lower(trim(s.nombre))='central'
     AND lower(trim(c.nombre))='principal'
     AND c.tipo IN ('whatsapp_qr','whatsapp_api') AND c.activo;
  IF cantidad=1 THEN
    UPDATE canales
       SET config=jsonb_set(COALESCE(config,'{}'::jsonb),'{principal_global}','true'::jsonb,true)
     WHERE id=canal;
    RAISE NOTICE 'IMPAR: línea principal de Central habilitada para todas las sucursales';
  ELSE
    RAISE NOTICE 'IMPAR: no se modifican canales (se esperaban 1, hay %). Habilitar desde Administración > Canales.',cantidad;
  END IF;
END $$;
