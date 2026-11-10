-- IMPAR: mensajes especiales de WhatsApp, Messenger e Instagram. Aditiva e idempotente.
-- reaccion / sistema: quedan en la conversación pero no pasan a «Cliente espera respuesta»
-- ni cuentan en los tiempos de respuesta. llamada / no_admitido: sí cuentan como contacto del cliente.
ALTER TABLE mensajes ADD COLUMN IF NOT EXISTS especial TEXT;
ALTER TABLE mensajes DROP CONSTRAINT IF EXISTS mensajes_especial_chk;
ALTER TABLE mensajes ADD CONSTRAINT mensajes_especial_chk
  CHECK (especial IS NULL OR especial IN ('reaccion','sistema','llamada','no_admitido'));

-- Mensajes ya guardados con el nombre técnico de la API (p. ej. «[reaction recibido]»): se pasan a español.
-- El emoji original no llegó a guardarse, así que la reacción queda como «Reaccionó a un mensaje».
UPDATE mensajes SET txt='Reaccionó a un mensaje', especial='reaccion'
 WHERE dir='in' AND txt='[reaction recibido]' AND especial IS NULL;
UPDATE mensajes SET txt='ℹ️ Aviso de WhatsApp (por ejemplo, el cliente cambió de número).', especial='sistema'
 WHERE dir='in' AND txt='[system recibido]' AND especial IS NULL;
UPDATE mensajes SET txt='⚠️ El cliente envió un tipo de mensaje que WhatsApp no permite ver en el CRM. Pedile que lo mande como texto o imagen.', especial='no_admitido'
 WHERE dir='in' AND txt IN ('[unsupported recibido]','[ephemeral recibido]','[edit recibido]','[revoke recibido]') AND especial IS NULL;
UPDATE mensajes SET txt='🛒 El cliente envió un pedido del catálogo de WhatsApp.' WHERE dir='in' AND txt='[order recibido]';
UPDATE mensajes SET txt=CASE txt
    WHEN '[image recibido]' THEN '📎 El cliente envió una imagen que no se pudo descargar. Pedile que la reenvíe.'
    WHEN '[video recibido]' THEN '📎 El cliente envió un video que no se pudo descargar. Pedile que lo reenvíe.'
    WHEN '[audio recibido]' THEN '📎 El cliente envió un audio que no se pudo descargar. Pedile que lo reenvíe.'
    WHEN '[document recibido]' THEN '📎 El cliente envió un documento que no se pudo descargar. Pedile que lo reenvíe.'
    WHEN '[sticker recibido]' THEN '📎 El cliente envió un sticker.'
    ELSE txt END
 WHERE dir='in' AND media_url IS NULL AND txt IN ('[image recibido]','[video recibido]','[audio recibido]','[document recibido]','[sticker recibido]');
