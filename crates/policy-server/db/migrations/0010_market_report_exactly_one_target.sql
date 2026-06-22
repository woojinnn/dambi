-- A moderation report targets either a listing or a review, never both.
-- Keep this as a named DB invariant so future writers cannot create an
-- ambiguous report row outside the HTTP helper path.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'market_reports'::regclass
      AND conname = 'market_reports_exactly_one_target'
  ) THEN
    ALTER TABLE market_reports
      ADD CONSTRAINT market_reports_exactly_one_target
      CHECK (
        (listing_id IS NOT NULL AND review_id IS NULL)
        OR (listing_id IS NULL AND review_id IS NOT NULL)
      )
      NOT VALID;
  END IF;
END $$;

ALTER TABLE market_reports VALIDATE CONSTRAINT market_reports_exactly_one_target;
