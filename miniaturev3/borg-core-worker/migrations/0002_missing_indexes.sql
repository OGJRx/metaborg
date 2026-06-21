-- [SQL-01] Missing indexes for WHERE and ORDER BY optimization
CREATE INDEX IF NOT EXISTS idx_tickets_fecha_estado ON tickets(fecha_cita, estado);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_rate_limits_window_end ON rate_limits(window_end);
CREATE INDEX IF NOT EXISTS idx_circuit_breakers_status_opened ON circuit_breakers(status, opened_at);
CREATE INDEX IF NOT EXISTS idx_seo_queue_status_scheduled ON seo_message_queue(status, scheduled_for);
CREATE INDEX IF NOT EXISTS idx_maintenance_rules_service ON maintenance_rules(service_name);
