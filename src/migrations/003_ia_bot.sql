-- ============================================================
-- iciia2.0 · Bot con OpenAI e instrucciones por línea
-- ============================================================
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS ia JSONB NOT NULL DEFAULT '{}';
ALTER TABLE canales  ADD COLUMN IF NOT EXISTS bot_activo BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE canales  ADD COLUMN IF NOT EXISTS bot_instrucciones TEXT NOT NULL DEFAULT '';
