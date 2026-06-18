-- Per-user application settings. v1 holds the user's own OpenAI API key, used
-- server-side by POST /v2/policy/llm-draft so the secret never reaches the
-- browser. The key is write-only over the API (set via PUT /v2/settings; GET
-- reports only whether it is present).
CREATE TABLE IF NOT EXISTS user_settings (
  user_id        TEXT PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
  openai_api_key TEXT,
  updated_at     BIGINT NOT NULL
);
