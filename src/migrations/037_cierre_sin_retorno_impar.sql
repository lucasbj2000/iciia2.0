-- IMPAR: las negociaciones en «Contactado» sin respuesta del cliente en 24 horas corridas se cierran solas
-- como «Sin retorno». Se activa el cierre automático y se fija el plazo (editable en Reglas y tiempos).
UPDATE empresas
   SET flags = COALESCE(flags,'{}'::jsonb) || '{"autoCierre":true}'::jsonb,
       reglas = jsonb_set(COALESCE(reglas,'{}'::jsonb), '{sinRetornoHoras}',
                COALESCE(reglas->'sinRetornoHoras','24'::jsonb))
 WHERE codigo='impar';
