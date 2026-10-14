-- IMPAR: mensajes cifrados originales para responder solicitudes de reintento
-- de WhatsApp multi-dispositivo. Los datos caducan a los 7 días.
-- No toca clientes, conversaciones, credenciales ni sesiones existentes.
CREATE TABLE IF NOT EXISTS wa_mensajes_reintento (
  empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  canal_id UUID NOT NULL REFERENCES canales(id) ON DELETE CASCADE,
  jid TEXT NOT NULL,
  mensaje_id TEXT NOT NULL,
  contenido BYTEA NOT NULL,
  creado TIMESTAMPTZ NOT NULL DEFAULT now(),
  expira TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '7 days'),
  PRIMARY KEY(canal_id, jid, mensaje_id)
);
CREATE INDEX IF NOT EXISTS idx_wa_reintentos_expira ON wa_mensajes_reintento(expira);
