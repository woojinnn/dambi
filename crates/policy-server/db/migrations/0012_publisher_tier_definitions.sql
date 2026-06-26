-- Data-driven publisher tier DEFINITIONS — admin-CRUD-able tiers.
--
-- 0011 made the publisher tier an account-level value (`users.publisher_tier`),
-- but the tier *set* was hardcoded (official/verified/community). This table
-- makes tiers data: an admin can create/delete tiers, each with a label, a
-- checkmark toggle, and a color. `users.publisher_tier` references a tier id.
--
-- Minimal badge model (per request): a tier is { label, checkmark on/off, color }.
--   official  — Wallet Guardians brand (blue). Reserved: never deletable, never
--               grantable via the admin API (set out of band only).
--   verified  — default "vetted" tier (checkmark). Reserved (built-in).
--   community — default for everyone. Reserved (built-in, no badge).
-- New tiers created by an admin are NOT reserved → deletable.
CREATE TABLE IF NOT EXISTS market_publisher_tiers (
  id         TEXT PRIMARY KEY,
  label      TEXT    NOT NULL,
  checkmark  BOOLEAN NOT NULL DEFAULT FALSE,
  color      TEXT    NOT NULL DEFAULT '#6B7280',
  rank       INTEGER NOT NULL DEFAULT 0,
  reserved   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at BIGINT  NOT NULL DEFAULT 0
);

-- Seed the three built-in tiers. Reserved so the admin UI can't delete them.
INSERT INTO market_publisher_tiers (id, label, checkmark, color, rank, reserved, created_at) VALUES
  ('official',  '공식',     TRUE,  '#2457C9', 100, TRUE, 0),
  ('verified',  '인증',     TRUE,  '#16A34A', 50,  TRUE, 0),
  ('community', '커뮤니티', FALSE, '#6B7280', 0,   TRUE, 0)
ON CONFLICT (id) DO NOTHING;

-- Referential integrity: a user's tier must be a real tier. All existing values
-- (official/verified/community) are seeded above, so the constraint adds cleanly.
-- Tier deletion reassigns members to 'community' first (handler), so this never
-- blocks a delete.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_publisher_tier_fkey'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_publisher_tier_fkey
      FOREIGN KEY (publisher_tier) REFERENCES market_publisher_tiers(id);
  END IF;
END $$;
