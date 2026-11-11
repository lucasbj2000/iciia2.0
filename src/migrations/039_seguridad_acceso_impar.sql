-- IMPAR: seguridad de acceso. Aditiva e idempotente.
-- sesion_version: cambiar la contraseña, desactivar, cambiar el rol o la verificación en dos pasos
-- invalida al instante todas las sesiones abiertas de esa persona.
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS sesion_version INT NOT NULL DEFAULT 0;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS debe_cambiar_clave BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS totp_secreto TEXT;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS totp_activo BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS totp_ultimo_paso BIGINT NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION usuarios_sesion_version_impar() RETURNS trigger AS $$
BEGIN
  IF NEW.pass_hash IS DISTINCT FROM OLD.pass_hash OR NEW.activo IS DISTINCT FROM OLD.activo
     OR NEW.rol IS DISTINCT FROM OLD.rol OR NEW.empresa_id IS DISTINCT FROM OLD.empresa_id
     OR NEW.totp_activo IS DISTINCT FROM OLD.totp_activo THEN
    NEW.sesion_version := OLD.sesion_version + 1;
  END IF;
  -- Una contraseña puesta por otra persona (alta, reseteo, edición) se cambia en el próximo ingreso.
  -- El cambio propio hace después un UPDATE aparte que apaga esta marca.
  IF NEW.pass_hash IS DISTINCT FROM OLD.pass_hash THEN
    NEW.debe_cambiar_clave := TRUE;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS usuarios_sesion_version_impar ON usuarios;
CREATE TRIGGER usuarios_sesion_version_impar BEFORE UPDATE ON usuarios
  FOR EACH ROW EXECUTE FUNCTION usuarios_sesion_version_impar();

CREATE TABLE IF NOT EXISTS login_intentos (
  id BIGSERIAL PRIMARY KEY,
  usuario TEXT NOT NULL,
  ip TEXT NOT NULL DEFAULT '',
  ok BOOLEAN NOT NULL,
  ts TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_login_intentos_usuario ON login_intentos(usuario, ts DESC);

-- Las cuentas nuevas reciben una contraseña elegida por otra persona: también se cambia en el primer ingreso.
CREATE OR REPLACE FUNCTION usuarios_alta_clave_impar() RETURNS trigger AS $$
BEGIN NEW.debe_cambiar_clave := TRUE; RETURN NEW; END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS usuarios_alta_clave_impar ON usuarios;
CREATE TRIGGER usuarios_alta_clave_impar BEFORE INSERT ON usuarios
  FOR EACH ROW EXECUTE FUNCTION usuarios_alta_clave_impar();

-- Aviso a administración cuando se pausa una cuenta por intentos fallidos.
UPDATE empresas SET notis = COALESCE(notis,'[]'::jsonb) ||
  '[{"k":"seguridad","t":"Alerta de seguridad","msg":"{cliente}","dest":"admin","v":true,"tono":"bad"}]'::jsonb
 WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(notis,'[]'::jsonb)) x WHERE x->>'k'='seguridad');
