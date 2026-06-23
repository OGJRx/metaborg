-- Migration: business_metrics
-- Description: Table for storing business and performance metrics

CREATE TABLE IF NOT EXISTS business_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  metric_key TEXT NOT NULL,       -- 'messages_processed', 'queue_depth', etc.
  metric_value REAL NOT NULL,
  platform TEXT,                  -- 'telegram', 'whatsapp'
  bot_type TEXT,                  -- 'frontend', 'backend'
  recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_metrics_key_time ON business_metrics(metric_key, recorded_at);
