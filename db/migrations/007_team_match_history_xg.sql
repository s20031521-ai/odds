-- Adds expected-goals columns to team_match_history (ADR 0003: additive).
-- Populated by scripts/join-xg-history.mjs from data/understat/*.json
-- (Understat getLeagueData, coverage: five top leagues from 2014/15).
-- Nullable: matches before 2014/15 and unmappable fixtures stay NULL and
-- the engine falls back to scoreline fitting for them.

ALTER TABLE team_match_history
  ADD COLUMN home_xg numeric CHECK (home_xg IS NULL OR home_xg >= 0),
  ADD COLUMN away_xg numeric CHECK (away_xg IS NULL OR away_xg >= 0);

CREATE INDEX idx_team_match_history_xg ON team_match_history (league_code, match_date)
  WHERE home_xg IS NOT NULL;
