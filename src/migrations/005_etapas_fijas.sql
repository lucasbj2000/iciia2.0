-- ============================================================
-- iciia2.0 · Etapas abiertas fijas y recuperación de mensajes
-- ============================================================

-- 1) Las etapas de cierre nunca cuentan como abiertas, y las tres de trabajo siempre sí.
UPDATE empresas e
   SET etapas = (
     SELECT jsonb_agg(
              CASE WHEN x.el->>'id' IN ('ganado','cerrado')
                     THEN x.el || '{"activa": false, "sistema": true}'::jsonb
                   WHEN x.el->>'id' IN ('nuevo','contactado','espera')
                     THEN x.el || '{"activa": true, "sistema": true}'::jsonb
                   ELSE x.el END
              ORDER BY x.ord)
       FROM jsonb_array_elements(e.etapas) WITH ORDINALITY AS x(el, ord))
 WHERE jsonb_typeof(e.etapas) = 'array' AND jsonb_array_length(e.etapas) > 0;

-- 2) Mensajes del cliente que quedaron dentro de una negociación ya cerrada:
--    se pasan a una negociación nueva en «Cliente espera respuesta».
--    Solo mensajes reales de un canal (msg_id) posteriores al cierre, de los últimos 30 días.
DO $$
DECLARE r record; nueva uuid;
BEGIN
  FOR r IN
    SELECT DISTINCT ON (n.contacto_id) n.*, x.desde
      FROM negociaciones n
      JOIN LATERAL (
        SELECT MIN(m.ts) AS desde FROM mensajes m
         WHERE m.negociacion_id = n.id AND m.dir = 'in' AND m.msg_id IS NOT NULL
           AND m.ts > n.entrada_etapa + interval '1 second'
           AND m.ts > now() - interval '30 days') x ON x.desde IS NOT NULL
     WHERE n.etapa IN ('ganado','cerrado')
       AND NOT EXISTS (SELECT 1 FROM negociaciones a
                        WHERE a.contacto_id = n.contacto_id AND a.etapa IN ('nuevo','contactado','espera'))
     ORDER BY n.contacto_id, n.entrada_etapa DESC
  LOOP
    INSERT INTO negociaciones (empresa_id, contacto_id, titulo, etapa, origen, canal_id, agente_id,
                               sucursal, linea, marcadores, bot_activo, creado, actualizado, entrada_etapa)
    VALUES (r.empresa_id, r.contacto_id, 'Cliente vuelve a comunicarse', 'espera', r.origen, r.canal_id, r.agente_id,
            r.sucursal, r.linea, '["frecuente"]'::jsonb, FALSE, r.desde, now(), r.desde)
    RETURNING id INTO nueva;
    UPDATE mensajes SET negociacion_id = nueva WHERE negociacion_id = r.id AND ts >= r.desde;
    INSERT INTO historial (empresa_id, negociacion_id, txt, por)
    VALUES (r.empresa_id, nueva,
            'Recuperada: el cliente escribió después del cierre y sus mensajes habían quedado en la negociación cerrada', 'Sistema');
  END LOOP;
END $$;

-- 3) Mensajes que fallaron (en cuarentena) se vuelven a procesar.
UPDATE inbox SET estado = 'pendiente', intentos = 0, error = NULL
 WHERE estado = 'cuarentena' AND ts > now() - interval '14 days';
