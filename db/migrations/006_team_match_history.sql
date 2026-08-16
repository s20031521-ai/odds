-- Historical scorelines + closing odds for offline model fitting and backtesting
-- (ADR 0003: additive training-data infrastructure; does not touch live odds/snapshots).
-- Populated by scripts/import-historical-scores.mjs from football-data.co.uk CSVs.

CREATE TABLE team_match_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source text NOT NULL,
  league_code text NOT NULL,
  season text NOT NULL,
  match_date date NOT NULL,
  home_team text NOT NULL,
  away_team text NOT NULL,
  home_goals smallint NOT NULL CHECK (home_goals >= 0),
  away_goals smallint NOT NULL CHECK (away_goals >= 0),
  closing_home_odds numeric CHECK (closing_home_odds IS NULL OR closing_home_odds > 1),
  closing_draw_odds numeric CHECK (closing_draw_odds IS NULL OR closing_draw_odds > 1),
  closing_away_odds numeric CHECK (closing_away_odds IS NULL OR closing_away_odds > 1),
  closing_totals_line numeric,
  closing_over_odds numeric CHECK (closing_over_odds IS NULL OR closing_over_odds > 1),
  closing_under_odds numeric CHECK (closing_under_odds IS NULL OR closing_under_odds > 1),
  closing_handicap_line numeric,
  closing_handicap_home_odds numeric CHECK (closing_handicap_home_odds IS NULL OR closing_handicap_home_odds > 1),
  closing_handicap_away_odds numeric CHECK (closing_handicap_away_odds IS NULL OR closing_handicap_away_odds > 1),
  imported_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, league_code, match_date, home_team, away_team)
);

CREATE INDEX idx_team_match_history_league_date ON team_match_history (league_code, match_date);
CREATE INDEX idx_team_match_history_home_team ON team_match_history (home_team, match_date);
CREATE INDEX idx_team_match_history_away_team ON team_match_history (away_team, match_date);
