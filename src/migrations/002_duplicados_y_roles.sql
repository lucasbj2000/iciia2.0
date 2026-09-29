-- ============================================================
-- iciia2.0 · Unificación de teléfonos y bloqueo definitivo de duplicados
-- ============================================================

-- 1) Teléfono normalizado: solo dígitos, sin prefijo 595 ni ceros iniciales.
--    0976586543, 595976586543, +595 976 586 543 y 00595976586543 → 976586543
UPDATE contactos
   SET tel_norm = regexp_replace(regexp_replace(regexp_replace(regexp_replace(
                    COALESCE(tel,''), '\D', '', 'g'), '^0+', ''), '^595', ''), '^0+', '');

-- 2) Fusionar contactos repetidos (mismo teléfono en la misma empresa).
--    Se conserva el más antiguo y se le pasan negociaciones, ubicaciones e identidades.
CREATE TEMP TABLE _cdup AS
  SELECT id, principal FROM (
    SELECT id, first_value(id) OVER (PARTITION BY empresa_id, tel_norm ORDER BY creado, id) AS principal
      FROM contactos WHERE tel_norm <> ''
  ) g WHERE id <> principal;

UPDATE negociaciones n SET contacto_id = d.principal FROM _cdup d WHERE n.contacto_id = d.id;
UPDATE ubicaciones  u SET contacto_id = d.principal FROM _cdup d WHERE u.contacto_id = d.id;
UPDATE solicitudes  s SET contacto_id = d.principal FROM _cdup d WHERE s.contacto_id = d.id;

UPDATE contactos c
   SET externos  = COALESCE(x.ext, '{}'::jsonb) || c.externos,
       frecuente = c.frecuente OR x.frec
  FROM (
    SELECT d.principal,
           (SELECT jsonb_object_agg(e.key, e.value)
              FROM contactos c2, jsonb_each(c2.externos) e
             WHERE c2.id IN (SELECT id FROM _cdup WHERE principal = d.principal)) AS ext,
           bool_or(c3.frecuente) AS frec
      FROM (SELECT DISTINCT principal FROM _cdup) d
      JOIN _cdup d2 ON d2.principal = d.principal
      JOIN contactos c3 ON c3.id = d2.id
     GROUP BY d.principal
  ) x
 WHERE c.id = x.principal;

DELETE FROM contactos WHERE id IN (SELECT id FROM _cdup);
DROP TABLE _cdup;

-- 3) Negociaciones abiertas repetidas del mismo cliente:
--    se conserva la más antigua y se le pasan mensajes e historial de las demás.
CREATE TEMP TABLE _ndup AS
  SELECT id, principal FROM (
    SELECT id, first_value(id) OVER (PARTITION BY contacto_id ORDER BY creado, id) AS principal
      FROM negociaciones WHERE etapa IN ('nuevo','contactado','espera')
  ) g WHERE id <> principal;

UPDATE mensajes  m SET negociacion_id = d.principal FROM _ndup d WHERE m.negociacion_id = d.id;
UPDATE historial h SET negociacion_id = d.principal FROM _ndup d WHERE h.negociacion_id = d.id;
UPDATE negociaciones
   SET etapa = 'cerrado', motivo = 'Duplicado fusionado automáticamente', actualizado = now()
 WHERE id IN (SELECT id FROM _ndup);
DROP TABLE _ndup;

-- 4) Bloqueo a nivel base de datos: imposible volver a duplicar.
CREATE UNIQUE INDEX IF NOT EXISTS idx_neg_activa_unica
  ON negociaciones(contacto_id) WHERE etapa IN ('nuevo','contactado','espera');
CREATE UNIQUE INDEX IF NOT EXISTS idx_contacto_tel_unico
  ON contactos(empresa_id, tel_norm) WHERE tel_norm <> '';

-- 5) La regla anti duplicado queda siempre activa.
UPDATE empresas SET flags = flags || '{"antiDuplicado": true}'::jsonb;
