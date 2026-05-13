-- Enable pg_cron extension for scheduled maintenance
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Schedule automatic deletion of analyses older than 30 days (free tier retention)
-- Runs daily at 2 AM UTC
SELECT cron.schedule(
  'delete-old-analyses-free-tier',
  '0 2 * * *',
  $$
  DELETE FROM analyses
  WHERE tier = 'free'
    AND created_at < CURRENT_TIMESTAMP - INTERVAL '30 days'
  $$
);

-- Grant execute permissions to postgres user (required for cron jobs)
GRANT EXECUTE ON FUNCTION cron.schedule(text, text, text) TO postgres;
