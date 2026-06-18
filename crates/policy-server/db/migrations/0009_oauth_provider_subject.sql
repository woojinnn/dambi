ALTER TABLE users
  ADD COLUMN IF NOT EXISTS provider_subject TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_provider_subject
  ON users(provider, provider_subject)
  WHERE provider_subject IS NOT NULL;
