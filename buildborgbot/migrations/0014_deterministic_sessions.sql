-- Migration 0014: Deterministic Sessions Index
CREATE INDEX IF NOT EXISTS idx_sessions_active_order ON factory_sessions(bot_id, platform, chat_id, estado_flujo, updated_at DESC);
