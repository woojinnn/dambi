-- Authoring docs for market policy listings: 정책 정의 / 적용 범위 /
-- 대상 사용자 / 판정에 사용될 데이터. Stored as a single JSONB object of plain
-- (single-language) strings: { definition, scope, audience, usedData }.
-- Authored in the editor, shipped on publish, shown on the listing detail
-- page. NULL for older/seed listings and for sets.

ALTER TABLE market_listings ADD COLUMN IF NOT EXISTS doc JSONB;
