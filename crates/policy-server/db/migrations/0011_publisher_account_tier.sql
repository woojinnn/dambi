-- Account-level publisher tier (official / verified / community).
--
-- Previously `publisher_tier` lived only on `market_listings` and was forced to
-- 'community' at publish time (promotion was out of band / DB-direct). We move
-- the source of truth to the publisher's ACCOUNT: the marketplace read derives a
-- listing's displayed tier from `users.publisher_tier`, so promoting/verifying an
-- account instantly applies to every listing it owns. The legacy
-- `market_listings.publisher_tier` column is retained but no longer drives display.
--
-- Tiers:
--   official  — the Wallet Guardians brand account (blue label). Reserved; set
--               out of band, never granted via the admin API.
--   verified  — accounts vetted by a market admin (checkmark badge).
--   community — default for everyone else.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS publisher_tier TEXT NOT NULL DEFAULT 'community';
