-- IMPAR: sin cambio obligatorio de contraseña ni verificación en dos pasos (decisión de administración).
-- Se mantiene la versión de sesión: cambiar la contraseña, el rol o dar de baja sigue cerrando las sesiones abiertas.
CREATE OR REPLACE FUNCTION usuarios_sesion_version_impar() RETURNS trigger AS $$
BEGIN
  IF NEW.pass_hash IS DISTINCT FROM OLD.pass_hash OR NEW.activo IS DISTINCT FROM OLD.activo
     OR NEW.rol IS DISTINCT FROM OLD.rol OR NEW.empresa_id IS DISTINCT FROM OLD.empresa_id THEN
    NEW.sesion_version := OLD.sesion_version + 1;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS usuarios_alta_clave_impar ON usuarios;
DROP FUNCTION IF EXISTS usuarios_alta_clave_impar();
UPDATE usuarios SET debe_cambiar_clave=FALSE WHERE debe_cambiar_clave;
UPDATE usuarios SET totp_activo=FALSE, totp_secreto=NULL WHERE totp_activo OR totp_secreto IS NOT NULL;
