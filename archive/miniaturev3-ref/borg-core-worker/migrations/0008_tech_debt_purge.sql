-- Migration 0008: Technical Debt Purge
-- Dropping unused tables from baseline schema after verifying zero references in code.
-- Principle: What is not measured or used must be removed to prevent rot.

DROP TABLE IF EXISTS vehicles;
DROP TABLE IF EXISTS maintenance_rules;
DROP TABLE IF EXISTS predictive_alerts;
DROP TABLE IF EXISTS agent_conversations;

-- Record audit successful event
INSERT INTO business_metrics (metric_key, metric_value, platform, bot_type, recorded_at)
VALUES ('migration_0008_cleanup_applied', 1, 'system', 'core', datetime('now'))
ON CONFLICT(metric_key, platform, bot_type) DO UPDATE SET
metric_value = 1, recorded_at = datetime('now');
