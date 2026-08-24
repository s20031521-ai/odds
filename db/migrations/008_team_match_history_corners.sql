-- Adds corner-count columns to team_match_history (ADR 0003: additive).
-- Populated by scripts/import-historical-scores.mjs from football-data.co.uk
-- CSVs (HC/AC columns; coverage: five top leagues, all seasons since 2019/20).
-- Nullable: rows imported before this migration stay NULL and the corners
-- engine (response: "corners") simply skips them when fitting.

ALTER TABLE team_match_history
  ADD COLUMN home_corners smallint CHECK (home_corners IS NULL OR home_corners >= 0),
  ADD COLUMN away_corners smallint CHECK (away_corners IS NULL OR away_corners >= 0);

CREATE INDEX idx_team_match_history_corners ON team_match_history (league_code, match_date)
  WHERE home_corners IS NOT NULL;
