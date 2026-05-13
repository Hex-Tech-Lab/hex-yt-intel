-- Enable pg_cron extension for scheduled jobs
CREATE EXTENSION IF NOT EXISTS "pg_cron";

-- Schedule daily cleanup of old free-tier analyses
-- Runs at 2 AM UTC (off-peak hours)
SELECT cron.schedule(
  'delete-old-free-analyses',
  '0 2 * * *',
  $$DELETE FROM analyses
    WHERE user_id IN (SELECT id FROM users WHERE tier = 'free')
    AND created_at < NOW() - INTERVAL '30 days'$$
);
