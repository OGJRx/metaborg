-- Migration 0010: Recreate Factory Bots (Schema Reset)
-- This migration drops and recreates the core factory tables to fix schema inconsistencies,
-- missing columns (owner_id), and NOT NULL constraints.

-- 1. Drop dependent tables first
DROP TABLE IF EXISTS factory_notifications;
DROP TABLE IF EXISTS factory_bot_admins;
DROP TABLE IF EXISTS factory_lookup_data;
DROP TABLE IF EXISTS factory_tickets;
DROP TABLE IF EXISTS factory_sessions;
DROP TABLE IF EXISTS factory_messages;
DROP TABLE IF EXISTS factory_feedback;
DROP TABLE IF EXISTS factory_bots;

-- 2. Recreate factory_bots
CREATE TABLE factory_bots (
    bot_id              TEXT PRIMARY KEY,
    bot_name            TEXT NOT NULL,
    token_var_name      TEXT NOT NULL,
    system_prompt       TEXT NOT NULL DEFAULT '',
    welcome_message     TEXT NOT NULL DEFAULT '',
    menu_json           TEXT NOT NULL DEFAULT '[]',
    bot_kind            TEXT NOT NULL DEFAULT 'open_chat'
                        CHECK (bot_kind IN ('open_chat','agendado','tool_specialist','kernel_admin')),
    config_json         TEXT NOT NULL DEFAULT '{}',
    slug                TEXT NOT NULL DEFAULT '',
    webhook_secret      TEXT NOT NULL DEFAULT '',
    token               TEXT,
    token_iv            TEXT,
    stack_id            TEXT,
    owner_id            INTEGER,
    meta_phone_number_id TEXT,
    meta_app_secret     TEXT,
    webhook_configured_at DATETIME,
    webhook_last_error  TEXT,
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX idx_factory_bots_slug ON factory_bots(slug);
CREATE INDEX idx_factory_bots_kind ON factory_bots(bot_kind);
CREATE UNIQUE INDEX idx_factory_bots_meta_phone
    ON factory_bots(meta_phone_number_id) WHERE meta_phone_number_id IS NOT NULL;

-- 3. Recreate factory_sessions
CREATE TABLE factory_sessions (
  session_id      TEXT PRIMARY KEY,         -- uuid
  bot_id          TEXT NOT NULL REFERENCES factory_bots(bot_id) ON DELETE CASCADE,
  platform        TEXT NOT NULL CHECK (platform IN ('telegram','whatsapp')),
  chat_id         TEXT NOT NULL,            -- telegram chat id o wa phone
  user_handle     TEXT NOT NULL DEFAULT '',
  estado_flujo    TEXT NOT NULL DEFAULT 'activo',
  paso_actual     INTEGER NOT NULL DEFAULT 0,
  paso_actual_text TEXT NOT NULL DEFAULT 'inicio',
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

-- 4. Recreate factory_tickets
CREATE TABLE factory_tickets (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id       TEXT NOT NULL UNIQUE,      -- human-readable
  bot_id          TEXT NOT NULL REFERENCES factory_bots(bot_id) ON DELETE CASCADE,
  session_id      TEXT,                      -- session_id is optional for tracking
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

-- 5. Recreate factory_lookup_data
CREATE TABLE factory_lookup_data (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bot_id TEXT NOT NULL REFERENCES factory_bots(bot_id) ON DELETE CASCADE,
    kind TEXT NOT NULL, -- 'obd', 'parts', etc
    key TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_lookup_bot_kind_key ON factory_lookup_data(bot_id, kind, key);

-- 6. Recreate factory_bot_admins
CREATE TABLE factory_bot_admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bot_id TEXT NOT NULL REFERENCES factory_bots(bot_id) ON DELETE CASCADE,
    admin_telegram_id INTEGER NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('owner', 'staff', 'readonly')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(bot_id, admin_telegram_id)
);

-- 7. Recreate factory_notifications
CREATE TABLE factory_notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bot_id TEXT NOT NULL REFERENCES factory_bots(bot_id) ON DELETE CASCADE,
    platform TEXT NOT NULL CHECK (platform IN ('telegram', 'whatsapp')),
    chat_id TEXT NOT NULL,
    content TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,
    scheduled_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_notifications_status ON factory_notifications(status, scheduled_at);

-- 8. Recreate factory_feedback
CREATE TABLE factory_feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bot_id TEXT NOT NULL REFERENCES factory_bots(bot_id) ON DELETE CASCADE,
    chat_id TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_feedback_bot ON factory_feedback(bot_id, created_at DESC);

-- 9. Recreate factory_messages
CREATE TABLE factory_messages (
    bot_id TEXT NOT NULL REFERENCES factory_bots(bot_id) ON DELETE CASCADE,
    chat_id TEXT NOT NULL,
    message_id INTEGER NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('user', 'model')),
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (bot_id, chat_id, message_id)
);

CREATE INDEX idx_messages_bot_chat ON factory_messages(bot_id, chat_id, created_at DESC);
