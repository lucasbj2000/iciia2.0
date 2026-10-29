-- IMPAR · Mensajes editados por clientes en WhatsApp.
-- Aditiva: editado = {original: texto recibido primero, veces: n, ts: hora de la última edición (ms)}.
ALTER TABLE mensajes ADD COLUMN IF NOT EXISTS editado JSONB;
