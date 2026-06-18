-- Drop the per-user settings table. The OpenAI API key is no longer stored
-- server-side: the dashboard keeps it in the browser (localStorage) and calls
-- OpenAI directly, so the key never reaches this server. 0006 stays in history
-- (already applied on deployed DBs); this migration removes the now-unused table
-- and any orphaned keys it held.
DROP TABLE IF EXISTS user_settings;
