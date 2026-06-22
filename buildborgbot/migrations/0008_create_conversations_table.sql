-- Migration 0008: Create Conversations Table
-- Resolves the collision between RelationalSessionAdapter and grammY conversations

CREATE TABLE IF NOT EXISTS factory_conversations (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_conversations_key ON factory_conversations(key);
