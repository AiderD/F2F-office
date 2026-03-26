-- Disable Supabase analyst crons (migrated to GitHub Actions)
-- Run in SQL Editor

SELECT cron.unschedule('f2f_analyst_research');
SELECT cron.unschedule('f2f_analyst_synthesize');

-- Verify: should return no f2f_analyst rows
SELECT * FROM cron.job WHERE jobname LIKE 'f2f_analyst%';
