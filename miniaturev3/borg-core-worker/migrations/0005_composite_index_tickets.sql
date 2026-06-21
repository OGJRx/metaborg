-- [SQL-01] Composite index for tickets(fecha_cita, estado)
-- This index is crucial for optimizing queries filtering by date and status, common in admin dashboards.
CREATE INDEX IF NOT EXISTS idx_tickets_fecha_estado ON tickets(fecha_cita, estado);
