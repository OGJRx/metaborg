-- 0013_update_messages_for_fragments.sql
-- Add columns to factory_messages instead of dropping it
ALTER TABLE factory_messages ADD COLUMN chunk_index INTEGER DEFAULT 0;
-- Note: 'role' CHECK constraint might still fail if we insert 'assistant_fragment'.
-- In SQLite, we can't easily drop a CHECK constraint.
-- However, we can recreate the table safely without losing data.

CREATE TABLE factory_messages_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bot_id TEXT NOT NULL REFERENCES factory_bots(bot_id) ON DELETE CASCADE,
    chat_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    chunk_index INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO factory_messages_new (bot_id, chat_id, role, content, created_at)
SELECT bot_id, chat_id, role, content, created_at FROM factory_messages;

DROP TABLE factory_messages;
ALTER TABLE factory_messages_new RENAME TO factory_messages;

CREATE INDEX idx_messages_bot_chat_created ON factory_messages(bot_id, chat_id, created_at DESC);
