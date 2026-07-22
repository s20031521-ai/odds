CREATE TABLE fixtures (
  id uuid PRIMARY KEY,
  home_team text NOT NULL,
  away_team text NOT NULL,
  normalized_home_team text NOT NULL,
  normalized_away_team text NOT NULL,
  commence_time timestamptz NOT NULL,
  league text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE fixture_aliases (
  provider text NOT NULL,
  provider_match_id text NOT NULL,
  fixture_id uuid NOT NULL REFERENCES fixtures(id),
  home_team text,
  away_team text,
  commence_time timestamptz,
  league text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_match_id)
);

CREATE TABLE fixture_match_audit (
  id bigserial PRIMARY KEY,
  provider text NOT NULL,
  provider_match_id text NOT NULL,
  reason text NOT NULL,
  candidate_fixture_ids uuid[] NOT NULL,
  matched_fixture_id uuid REFERENCES fixtures(id),
  raw jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE prediction_snapshots
  ADD COLUMN strategy_version text,
  ADD COLUMN fixture_id uuid REFERENCES fixtures(id),
  ADD COLUMN first_qualified_at timestamptz,
  ADD COLUMN last_qualified_at timestamptz;

CREATE TABLE recommendation_observations (
  id bigserial PRIMARY KEY,
  snapshot_id bigint NOT NULL REFERENCES prediction_snapshots(id),
  fingerprint text NOT NULL,
  first_evaluated_at timestamptz NOT NULL,
  last_evaluated_at timestamptz NOT NULL,
  inputs jsonb NOT NULL,
  buyable_quotes jsonb NOT NULL,
  UNIQUE (snapshot_id, fingerprint)
);

CREATE INDEX fixtures_kickoff_idx
  ON fixtures (commence_time, normalized_home_team, normalized_away_team);
CREATE INDEX fixture_aliases_fixture_id_idx
  ON fixture_aliases (fixture_id);
CREATE INDEX prediction_snapshots_current_strategy_idx
  ON prediction_snapshots (strategy_version, commence_time)
  WHERE strategy_version IS NOT NULL;
CREATE INDEX recommendation_observations_history_idx
  ON recommendation_observations (snapshot_id, first_evaluated_at, id);
