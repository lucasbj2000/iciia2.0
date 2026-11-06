-- Línea (canal) por la que entró o salió cada mensaje, para mostrarla en el chat
-- (WhatsApp verificado / WhatsApp normal). No borra ni mueve mensajes.
ALTER TABLE mensajes ADD COLUMN IF NOT EXISTS canal_id UUID REFERENCES canales(id) ON DELETE SET NULL;
-- Mensajes enviados anteriores: su línea queda registrada en la cola de envío.
UPDATE mensajes m SET canal_id = o.canal_id
  FROM outbox o
 WHERE m.canal_id IS NULL AND o.mensaje_id = m.id AND o.empresa_id = m.empresa_id AND o.canal_id IS NOT NULL;
