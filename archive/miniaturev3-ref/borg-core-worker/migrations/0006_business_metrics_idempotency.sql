-- [SQL-01] Ensure uniqueness for metrics that represent single state values
-- This allows using ON CONFLICT DO UPDATE to keep only the latest value for certain metrics.
-- For D1 size, we only care about the most recent measurement.

-- First, clean up any duplicates that might exist (though unlikely in a fresh DB)
DELETE FROM business_metrics
WHERE id NOT IN (
    SELECT MAX(id)
    FROM business_metrics
    GROUP BY metric_key, platform, bot_type
);

-- Add a unique index to support UPSERT logic
CREATE UNIQUE INDEX IF NOT EXISTS idx_metrics_unique_key ON business_metrics(metric_key, platform, bot_type);
