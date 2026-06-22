-- Migration 0007: Unified Titanium Core Schema

-- Ampliar factory_bots
ALTER TABLE factory_bots ADD COLUMN bot_kind TEXT NOT NULL DEFAULT 'open_chat' CHECK (bot_kind IN ('open_chat','agendado','tool_specialist'));
ALTER TABLE factory_bots ADD COLUMN config_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE factory_bots ADD COLUMN meta_phone_number_id TEXT;
ALTER TABLE factory_bots ADD COLUMN meta_app_secret TEXT;
ALTER TABLE factory_bots ADD COLUMN webhook_configured_at DATETIME;
ALTER TABLE factory_bots ADD COLUMN webhook_last_error TEXT;

CREATE INDEX idx_factory_bots_kind ON factory_bots(bot_kind);
CREATE UNIQUE INDEX idx_factory_bots_meta_phone ON factory_bots(meta_phone_number_id) WHERE meta_phone_number_id IS NOT NULL;

-- Reemplazar factory_sessions (KV -> Relacional)
-- NOTA: Esto romperá el D1Adapter de grammY por defecto, se requiere refactor en engine.ts
DROP TABLE IF EXISTS factory_sessions;

CREATE TABLE factory_sessions (
  session_id      TEXT PRIMARY KEY,         -- uuid
  bot_id          TEXT NOT NULL REFERENCES factory_bots(bot_id) ON DELETE CASCADE,
  platform        TEXT NOT NULL CHECK (platform IN ('telegram','whatsapp')),
  chat_id         TEXT NOT NULL,            -- telegram chat id o wa phone
  user_handle     TEXT NOT NULL DEFAULT '',
  estado_flujo    TEXT NOT NULL DEFAULT 'activo',
  paso_actual     INTEGER NOT NULL DEFAULT 0,
  step_data       TEXT NOT NULL DEFAULT '{}', -- JSON genérico
  cached_slots    TEXT,
  cached_slots_at DATETIME,
  expires_at      DATETIME NOT NULL,
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX idx_sessions_active
  ON factory_sessions(bot_id, platform, chat_id, estado_flujo)
  WHERE estado_flujo NOT IN ('confirmado','cancelado');
CREATE INDEX idx_sessions_expires ON factory_sessions(expires_at);
CREATE INDEX idx_sessions_bot ON factory_sessions(bot_id, updated_at);

-- Tickets (Relacional, genérica)
CREATE TABLE factory_tickets (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id       TEXT NOT NULL UNIQUE,      -- human-readable
  bot_id          TEXT NOT NULL REFERENCES factory_bots(bot_id) ON DELETE CASCADE,
  session_id      TEXT NOT NULL REFERENCES factory_sessions(session_id),
  platform        TEXT NOT NULL,
  chat_id         TEXT NOT NULL,
  step_data       TEXT NOT NULL,             -- snapshot del step_data al confirmar
  fecha_cita      TEXT,                      -- si el flujo lo define
  hora_cita       TEXT,
  hora_fin        TEXT,
  estado          TEXT NOT NULL DEFAULT 'pendiente'
                  CHECK (estado IN ('pendiente','confirmado','cancelado','completado','no_show')),
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_tickets_bot_fecha ON factory_tickets(bot_id, fecha_cita, estado);
CREATE INDEX idx_tickets_session ON factory_tickets(session_id);

-- Lookup data (OBD, catálogos, etc)
CREATE TABLE factory_lookup_data (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bot_id TEXT NOT NULL REFERENCES factory_bots(bot_id) ON DELETE CASCADE,
    kind TEXT NOT NULL, -- 'obd', 'parts', etc
    key TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_lookup_bot_kind_key ON factory_lookup_data(bot_id, kind, key);
