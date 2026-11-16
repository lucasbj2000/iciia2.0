-- ============================================================
-- IMPAR · respuestas rápidas agrupadas por sector
-- ============================================================
-- «grupo» junta plantillas del equipo en un sector propio del chat
-- (por ejemplo, «Ubicación de sucursales») y «titulo» es el nombre corto
-- que se ve en el botón; lo que se envía sigue siendo «txt».
ALTER TABLE rapidas ADD COLUMN IF NOT EXISTS grupo  TEXT;
ALTER TABLE rapidas ADD COLUMN IF NOT EXISTS titulo TEXT;

-- creado escalonado para que se muestren en este orden.
INSERT INTO rapidas (empresa_id, txt, ambito, grupo, titulo, creado)
SELECT e.id, '📍 Sucursal ' || s.titulo || E'\n' || s.link, 'empresa', 'Ubicación de sucursales', s.titulo,
       now() + s.orden * interval '1 millisecond'
  FROM empresas e
 CROSS JOIN (VALUES
   (1, 'Barrio Obrero',        'https://maps.app.goo.gl/fZXoBfB5XaTGFh8TA'),
   (2, 'Lambaré',              'https://maps.app.goo.gl/cF4KhNhHqUeZQMPn9'),
   (3, 'Madame Lynch',         'https://maps.app.goo.gl/KuR1K9mpL3njmabt7'),
   (4, 'Encarnación',          'https://maps.app.goo.gl/ESgCtFcy1M6qPUmk6'),
   (5, 'Ciudad del Este',      'https://maps.app.goo.gl/f2T7i2tAkojTeLSR7'),
   (6, 'Pedro Juan Caballero', 'https://maps.app.goo.gl/Z1Bis4L8aZFfJ2kk6')
 ) AS s(orden, titulo, link)
 WHERE NOT EXISTS (SELECT 1 FROM rapidas r
                    WHERE r.empresa_id = e.id AND r.grupo = 'Ubicación de sucursales' AND r.titulo = s.titulo)
 ORDER BY e.id, s.orden;
