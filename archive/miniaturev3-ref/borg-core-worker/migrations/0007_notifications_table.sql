-- 🏛️ TITANIUM NOTIFICATIONS v9.7.0
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  appointment_id INTEGER REFERENCES tickets(id),
  type TEXT NOT NULL DEFAULT 'info',
  message TEXT NOT NULL,
  read INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(read) WHERE read = 0;
