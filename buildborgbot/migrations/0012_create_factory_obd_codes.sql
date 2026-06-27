-- Migration: 0012_create_factory_obd_codes.sql
-- Create dedicated table for OBD codes to prevent accidental deletion during bot metadata cleanups

CREATE TABLE IF NOT EXISTS factory_obd_codes (
    code TEXT PRIMARY KEY,
    description TEXT NOT NULL,
    category TEXT,
    severity TEXT,
    payload_json TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_obd_code ON factory_obd_codes(code);
