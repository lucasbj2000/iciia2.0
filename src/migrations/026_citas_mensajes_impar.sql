-- IMPAR · Respuestas citadas de WhatsApp (cliente → CRM y CRM → cliente).
-- Aditiva: no modifica mensajes existentes, contactos, sesiones ni credenciales.
-- cita = {id: mensajes.id citado o null, ext: ID WhatsApp citado, dir: 'in'|'out', txt: vista previa}
ALTER TABLE mensajes ADD COLUMN IF NOT EXISTS cita JSONB;
ALTER TABLE outbox ADD COLUMN IF NOT EXISTS cita JSONB;
