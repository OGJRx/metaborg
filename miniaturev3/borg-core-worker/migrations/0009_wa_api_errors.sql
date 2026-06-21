-- Migration: 0009_wa_api_errors.sql
-- Description: Structured logging for WhatsApp API errors

CREATE TABLE IF NOT EXISTS wa_api_errors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone_number TEXT NOT NULL,
    paso_actual INTEGER,
    http_status INTEGER NOT NULL,
    error_code TEXT,
    fbtrace_id TEXT,
    trace_id TEXT,
    payload_summary TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_wa_errors_created ON wa_api_errors(created_at);
CREATE INDEX IF NOT EXISTS idx_wa_errors_code ON wa_api_errors(error_code);
