-- Migration 0009: Platform Borg Definitive Schema

CREATE TABLE IF NOT EXISTS factory_bot_admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bot_id TEXT NOT NULL REFERENCES factory_bots(bot_id) ON DELETE CASCADE,
    admin_telegram_id INTEGER NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('owner', 'staff', 'readonly')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(bot_id, admin_telegram_id)
);

CREATE TABLE IF NOT EXISTS factory_notifications (
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

CREATE INDEX IF NOT EXISTS idx_notifications_status ON factory_notifications(status, scheduled_at);

ALTER TABLE factory_bots ADD COLUMN stack_id TEXT;
ALTER TABLE factory_bots ADD COLUMN owner_id INTEGER;

ALTER TABLE factory_sessions ADD COLUMN paso_actual_text TEXT NOT NULL DEFAULT 'inicio';
