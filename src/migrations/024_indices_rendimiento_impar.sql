-- IMPAR: consultas frecuentes del tablero y búsquedas de usuario.
-- Índices aditivos, sin reescritura de chats, mensajes ni credenciales WhatsApp.
CREATE INDEX IF NOT EXISTS idx_impar_tablero_actualizado
 ON negociaciones(empresa_id,actualizado DESC,id);
CREATE INDEX IF NOT EXISTS idx_impar_ubicaciones_por_negociacion
 ON ubicaciones(negociacion_id);
CREATE INDEX IF NOT EXISTS idx_impar_login_usuario
 ON usuarios(empresa_id,lower(usuario)) WHERE activo=TRUE;
