-- ============================================================
-- iciia2.0 · Esquema completo
-- Aislamiento multiempresa por empresa_id en TODAS las tablas
-- ============================================================
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------- EMPRESAS ----------
CREATE TABLE IF NOT EXISTS empresas (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo     TEXT UNIQUE NOT NULL,
  nombre     TEXT NOT NULL,
  color      TEXT NOT NULL DEFAULT '#FF7A00',
  logo       TEXT DEFAULT '',
  ciudad     TEXT DEFAULT 'Asunción',
  activa     BOOLEAN NOT NULL DEFAULT TRUE,
  etapas     JSONB NOT NULL DEFAULT '[]',
  motivos    JSONB NOT NULL DEFAULT '[]',
  modulos    JSONB NOT NULL DEFAULT '[]',
  lineas     JSONB NOT NULL DEFAULT '[]',
  flags      JSONB NOT NULL DEFAULT '{}',
  notis      JSONB NOT NULL DEFAULT '[]',
  reglas     JSONB NOT NULL DEFAULT '{}',
  stock      JSONB NOT NULL DEFAULT '{}',
  bot        JSONB NOT NULL DEFAULT '{}',
  creado     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- SUCURSALES ----------
CREATE TABLE IF NOT EXISTS sucursales (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id     UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  nombre         TEXT NOT NULL,
  ciudad         TEXT DEFAULT '',
  direccion      TEXT DEFAULT '',
  lat            DOUBLE PRECISION,
  lon            DOUBLE PRECISION,
  tel            TEXT DEFAULT '',
  email          TEXT DEFAULT '',
  horario        TEXT DEFAULT '08:00 a 17:00',
  responsable_id UUID,
  activa         BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (empresa_id, nombre)
);
CREATE INDEX IF NOT EXISTS idx_suc_emp ON sucursales(empresa_id);

-- ---------- USUARIOS ----------
CREATE TABLE IF NOT EXISTS usuarios (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id     UUID REFERENCES empresas(id) ON DELETE CASCADE,
  nombre         TEXT NOT NULL,
  usuario        TEXT NOT NULL,
  pass_hash      TEXT NOT NULL,
  rol            TEXT NOT NULL DEFAULT 'agente',
  sucursal       TEXT DEFAULT '',
  linea          TEXT DEFAULT '',
  equipo         TEXT,
  email          TEXT DEFAULT '',
  tel            TEXT DEFAULT '',
  foto           TEXT DEFAULT '',
  nacimiento     DATE,
  disponibilidad TEXT NOT NULL DEFAULT 'fuera',
  activo         BOOLEAN NOT NULL DEFAULT TRUE,
  oculto         BOOLEAN NOT NULL DEFAULT FALSE,
  rapidas        JSONB NOT NULL DEFAULT '[]',
  prefs          JSONB NOT NULL DEFAULT '{}',
  ultimo_login   TIMESTAMPTZ,
  creado         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_usr_unico
  ON usuarios(COALESCE(empresa_id,'00000000-0000-0000-0000-000000000000'::uuid), lower(usuario));
CREATE INDEX IF NOT EXISTS idx_usr_emp ON usuarios(empresa_id);

CREATE TABLE IF NOT EXISTS marcaciones (
  id         BIGSERIAL PRIMARY KEY,
  empresa_id UUID REFERENCES empresas(id) ON DELETE CASCADE,
  usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  estado     TEXT NOT NULL,
  ts         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_marc_usr ON marcaciones(usuario_id, ts DESC);

-- ---------- ARCHIVOS ----------
CREATE TABLE IF NOT EXISTS archivos (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  usuario_id UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  nombre     TEXT NOT NULL,
  archivo    TEXT NOT NULL,
  mime       TEXT NOT NULL,
  tipo       TEXT NOT NULL,
  bytes      BIGINT NOT NULL DEFAULT 0,
  ancho      INT,
  alto       INT,
  origen     TEXT NOT NULL DEFAULT 'agente',
  creado     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_arch_emp ON archivos(empresa_id, creado DESC);

-- ---------- CANALES (por sucursal) ----------
CREATE TABLE IF NOT EXISTS canales (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  sucursal_id     UUID REFERENCES sucursales(id) ON DELETE SET NULL,
  linea           TEXT DEFAULT '',
  tipo            TEXT NOT NULL,
  nombre          TEXT NOT NULL,
  estado          TEXT NOT NULL DEFAULT 'desconectado',
  numero          TEXT DEFAULT '',
  config          JSONB NOT NULL DEFAULT '{}',
  sesion          TEXT,
  activo          BOOLEAN NOT NULL DEFAULT TRUE,
  ultimo_error    TEXT,
  ultima_conexion TIMESTAMPTZ,
  ultimo_mensaje  TIMESTAMPTZ,
  creado          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_can_emp ON canales(empresa_id);
CREATE INDEX IF NOT EXISTS idx_can_suc ON canales(sucursal_id);

-- ---------- CONTACTOS ----------
CREATE TABLE IF NOT EXISTS contactos (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id     UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  nombre         TEXT NOT NULL,
  tel            TEXT DEFAULT '',
  tel_norm       TEXT DEFAULT '',
  email          TEXT DEFAULT '',
  doc            TEXT DEFAULT '',
  ciudad         TEXT DEFAULT '',
  direccion      TEXT DEFAULT '',
  lat            DOUBLE PRECISION,
  lon            DOUBLE PRECISION,
  sucursal       TEXT DEFAULT '',
  linea          TEXT DEFAULT '',
  responsable_id UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  frecuente      BOOLEAN NOT NULL DEFAULT FALSE,
  notas          TEXT DEFAULT '',
  externos       JSONB NOT NULL DEFAULT '{}',
  creado         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_con_emp ON contactos(empresa_id);
CREATE INDEX IF NOT EXISTS idx_con_tel ON contactos(empresa_id, tel_norm);
CREATE INDEX IF NOT EXISTS idx_con_ext ON contactos USING GIN (externos);

-- ---------- NEGOCIACIONES ----------
CREATE TABLE IF NOT EXISTS negociaciones (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  contacto_id   UUID NOT NULL REFERENCES contactos(id) ON DELETE CASCADE,
  titulo        TEXT DEFAULT '',
  etapa         TEXT NOT NULL DEFAULT 'nuevo',
  origen        TEXT NOT NULL DEFAULT 'otro',
  canal_id      UUID REFERENCES canales(id) ON DELETE SET NULL,
  agente_id     UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  sucursal      TEXT DEFAULT '',
  linea         TEXT DEFAULT '',
  valor         BIGINT NOT NULL DEFAULT 0,
  monto_cierre  BIGINT NOT NULL DEFAULT 0,
  motivo        TEXT,
  marcadores    JSONB NOT NULL DEFAULT '[]',
  bot_activo    BOOLEAN NOT NULL DEFAULT TRUE,
  aviso_sla     BOOLEAN NOT NULL DEFAULT FALSE,
  creado        TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado   TIMESTAMPTZ NOT NULL DEFAULT now(),
  entrada_etapa TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_neg_emp   ON negociaciones(empresa_id);
CREATE INDEX IF NOT EXISTS idx_neg_etapa ON negociaciones(empresa_id, etapa);
CREATE INDEX IF NOT EXISTS idx_neg_cont  ON negociaciones(contacto_id);
CREATE INDEX IF NOT EXISTS idx_neg_ag    ON negociaciones(empresa_id, agente_id);

-- ---------- MENSAJES ----------
CREATE TABLE IF NOT EXISTS mensajes (
  id             BIGSERIAL PRIMARY KEY,
  empresa_id     UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  negociacion_id UUID NOT NULL REFERENCES negociaciones(id) ON DELETE CASCADE,
  dir            TEXT NOT NULL,
  txt            TEXT DEFAULT '',
  archivo_id     UUID REFERENCES archivos(id) ON DELETE SET NULL,
  media_url      TEXT,
  media_tipo     TEXT,
  media_nombre   TEXT,
  media_bytes    BIGINT,
  ubicacion      JSONB,
  bot            BOOLEAN NOT NULL DEFAULT FALSE,
  autor_id       UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  msg_id         TEXT,
  estado         TEXT DEFAULT 'ok',
  ts             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_msg_ext ON mensajes(empresa_id, msg_id) WHERE msg_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_msg_neg ON mensajes(negociacion_id, ts);

-- ---------- UBICACIONES DETECTADAS ----------
CREATE TABLE IF NOT EXISTS ubicaciones (
  id             BIGSERIAL PRIMARY KEY,
  empresa_id     UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  contacto_id    UUID NOT NULL REFERENCES contactos(id) ON DELETE CASCADE,
  negociacion_id UUID REFERENCES negociaciones(id) ON DELETE CASCADE,
  fuente         TEXT NOT NULL DEFAULT 'texto',  -- gps | link | texto
  texto          TEXT DEFAULT '',
  direccion      TEXT DEFAULT '',
  lat            DOUBLE PRECISION,
  lon            DOUBLE PRECISION,
  confianza      TEXT DEFAULT 'media',           -- alta | media | baja
  confirmada     BOOLEAN NOT NULL DEFAULT FALSE,
  ts             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ubi_cont ON ubicaciones(contacto_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_ubi_emp  ON ubicaciones(empresa_id, ts DESC);

-- ---------- HISTORIAL / TRANSFERENCIAS ----------
CREATE TABLE IF NOT EXISTS historial (
  id             BIGSERIAL PRIMARY KEY,
  empresa_id     UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  negociacion_id UUID NOT NULL REFERENCES negociaciones(id) ON DELETE CASCADE,
  txt            TEXT NOT NULL,
  por            TEXT DEFAULT '',
  ts             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_his_neg ON historial(negociacion_id, ts DESC);

CREATE TABLE IF NOT EXISTS transferencias (
  id             BIGSERIAL PRIMARY KEY,
  empresa_id     UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  negociacion_id UUID NOT NULL REFERENCES negociaciones(id) ON DELETE CASCADE,
  de_nombre      TEXT,
  a_nombre       TEXT NOT NULL,
  por            TEXT,
  nota           TEXT DEFAULT '',
  ts             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_trf_neg ON transferencias(negociacion_id, ts DESC);

CREATE TABLE IF NOT EXISTS solicitudes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id  UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  contacto_id UUID NOT NULL REFERENCES contactos(id) ON DELETE CASCADE,
  de_id       UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  para_id     UUID REFERENCES usuarios(id) ON DELETE CASCADE,
  estado      TEXT NOT NULL DEFAULT 'pendiente',
  ts          TIMESTAMPTZ NOT NULL DEFAULT now(),
  resuelta    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_sol_emp ON solicitudes(empresa_id, estado);

-- ---------- RESPUESTAS RÁPIDAS ----------
CREATE TABLE IF NOT EXISTS rapidas (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id   UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  txt          TEXT DEFAULT '',
  ambito       TEXT NOT NULL DEFAULT 'empresa',
  sucursal     TEXT,
  archivo_id   UUID REFERENCES archivos(id) ON DELETE SET NULL,
  media_url    TEXT,
  media_tipo   TEXT,
  media_nombre TEXT,
  autor_id     UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  creado       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rap_emp ON rapidas(empresa_id);

-- ---------- COMUNICACIÓN INTERNA ----------
CREATE TABLE IF NOT EXISTS grupos (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id  UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  nombre      TEXT NOT NULL,
  descripcion TEXT DEFAULT '',
  miembros    JSONB NOT NULL DEFAULT '[]',
  creado      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_grp_emp ON grupos(empresa_id);

CREATE TABLE IF NOT EXISTS mensajes_internos (
  id         BIGSERIAL PRIMARY KEY,
  empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  grupo_id   UUID REFERENCES grupos(id) ON DELETE CASCADE,
  de_id      UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  para_id    UUID REFERENCES usuarios(id) ON DELETE CASCADE,
  txt        TEXT NOT NULL,
  leido      JSONB NOT NULL DEFAULT '[]',
  ts         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mi_grp ON mensajes_internos(grupo_id, ts);
CREATE INDEX IF NOT EXISTS idx_mi_dm  ON mensajes_internos(empresa_id, de_id, para_id, ts);

-- ---------- CALENDARIO ----------
CREATE TABLE IF NOT EXISTS eventos (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id  UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  tipo        TEXT NOT NULL DEFAULT 'actividad',
  titulo      TEXT NOT NULL,
  fecha       DATE NOT NULL,
  hora        TEXT DEFAULT '',
  descripcion TEXT DEFAULT '',
  sucursal    TEXT DEFAULT '',
  creado_por  TEXT DEFAULT '',
  creado      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ev_emp ON eventos(empresa_id, fecha);

-- ---------- NOTIFICACIONES / AUDITORÍA ----------
CREATE TABLE IF NOT EXISTS notificaciones (
  id         BIGSERIAL PRIMARY KEY,
  empresa_id UUID REFERENCES empresas(id) ON DELETE CASCADE,
  usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  tipo       TEXT NOT NULL,
  titulo     TEXT NOT NULL,
  msg        TEXT NOT NULL,
  tono       TEXT DEFAULT 'ok',
  ref        UUID,
  leida      BOOLEAN NOT NULL DEFAULT FALSE,
  ts         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_not_usr ON notificaciones(usuario_id, leida, ts DESC);

CREATE TABLE IF NOT EXISTS auditoria (
  id         BIGSERIAL PRIMARY KEY,
  empresa_id UUID REFERENCES empresas(id) ON DELETE CASCADE,
  usuario    TEXT DEFAULT '',
  accion     TEXT NOT NULL,
  detalle    TEXT DEFAULT '',
  ip         TEXT,
  ts         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_aud_emp ON auditoria(empresa_id, ts DESC);

-- ---------- MENSAJERÍA DURABLE ----------
CREATE TABLE IF NOT EXISTS inbox (
  id           BIGSERIAL PRIMARY KEY,
  empresa_id   UUID REFERENCES empresas(id) ON DELETE CASCADE,
  canal_id     UUID REFERENCES canales(id) ON DELETE CASCADE,
  tipo         TEXT NOT NULL,
  ext_id       TEXT NOT NULL,
  remitente    TEXT NOT NULL,
  nombre       TEXT DEFAULT '',
  txt          TEXT DEFAULT '',
  media_url    TEXT,
  media_tipo   TEXT,
  media_nombre TEXT,
  ubicacion    JSONB,
  payload      JSONB,
  estado       TEXT NOT NULL DEFAULT 'pendiente',
  intentos     INT NOT NULL DEFAULT 0,
  error        TEXT,
  ts           TIMESTAMPTZ NOT NULL DEFAULT now(),
  procesado    TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_inbox_ext ON inbox(canal_id, ext_id);
CREATE INDEX IF NOT EXISTS idx_inbox_estado ON inbox(estado, ts);

CREATE TABLE IF NOT EXISTS outbox (
  id             BIGSERIAL PRIMARY KEY,
  empresa_id     UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  canal_id       UUID REFERENCES canales(id) ON DELETE CASCADE,
  negociacion_id UUID REFERENCES negociaciones(id) ON DELETE CASCADE,
  destino        TEXT NOT NULL,
  txt            TEXT,
  archivo_id     UUID REFERENCES archivos(id) ON DELETE SET NULL,
  media_url      TEXT,
  media_tipo     TEXT,
  media_nombre   TEXT,
  estado         TEXT NOT NULL DEFAULT 'pendiente',
  intentos       INT NOT NULL DEFAULT 0,
  error          TEXT,
  ts             TIMESTAMPTZ NOT NULL DEFAULT now(),
  enviado        TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_outbox_estado ON outbox(estado, ts);
