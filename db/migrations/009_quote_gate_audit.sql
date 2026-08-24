-- Phase 3 shadow A/B audit metadata. Every observation keeps the gate version
-- and reason counts that produced its filtered quote set.

ALTER TABLE recommendation_observations
  ADD COLUMN quote_gate jsonb NOT NULL DEFAULT '{}'::jsonb;
