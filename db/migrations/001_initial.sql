CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  checksum_sha256 text NOT NULL,
  applied_at timestamptz NOT NULL
);

CREATE TABLE owners (
  id uuid PRIMARY KEY,
  username text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  disabled_at timestamptz,
  created_at timestamptz NOT NULL
);

CREATE TABLE sessions (
  id uuid PRIMARY KEY,
  owner_id uuid REFERENCES owners(id),
  token_hash bytea UNIQUE NOT NULL,
  csrf_hash bytea NOT NULL,
  created_at timestamptz,
  last_seen_at timestamptz,
  idle_expires_at timestamptz,
  absolute_expires_at timestamptz,
  revoked_at timestamptz
);

CREATE TABLE login_attempts (
  scope_key text PRIMARY KEY,
  failed_count integer,
  window_started_at timestamptz,
  blocked_until timestamptz
);

CREATE TABLE prediction_snapshots (
  id bigserial PRIMARY KEY,
  identity_key text UNIQUE NOT NULL,
  match_id text,
  market text,
  prediction text,
  line double precision,
  odds double precision,
  chance double precision,
  edge double precision,
  saved_at timestamptz,
  commence_time timestamptz,
  model_version text,
  source text,
  snapshot_status text,
  rejection_reason text,
  raw jsonb NOT NULL,
  CONSTRAINT prediction_snapshots_odds_valid CHECK (
    odds IS NULL OR (odds > 0 AND odds < 'Infinity'::double precision)
  ),
  CONSTRAINT prediction_snapshots_chance_valid CHECK (
    chance IS NULL OR (chance >= 0 AND chance <= 1)
  )
);

CREATE TABLE results (
  id bigserial PRIMARY KEY,
  identity_key text UNIQUE NOT NULL,
  match_id text,
  market text,
  actual text,
  source text,
  source_priority integer,
  completed_at timestamptz,
  raw jsonb NOT NULL
);

CREATE TABLE live_odds (
  id bigserial PRIMARY KEY,
  identity_key text UNIQUE NOT NULL,
  entry_id text,
  provider text,
  match_id text,
  home_team text,
  away_team text,
  commence_time timestamptz,
  market text,
  selection text,
  line double precision,
  odds double precision,
  observed_at timestamptz,
  expires_at timestamptz,
  raw jsonb NOT NULL,
  CONSTRAINT live_odds_odds_valid CHECK (
    odds IS NULL OR (odds > 0 AND odds < 'Infinity'::double precision)
  )
);

CREATE TABLE collector_state (
  state_key text PRIMARY KEY,
  state jsonb NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE import_runs (
  id uuid PRIMARY KEY,
  source_name text,
  source_sha256 text,
  importer_version text,
  status text,
  total_rows integer,
  accepted_rows integer,
  rejected_rows integer,
  started_at timestamptz,
  finished_at timestamptz,
  UNIQUE (source_name, source_sha256, importer_version)
);

CREATE TABLE import_rows (
  import_run_id uuid REFERENCES import_runs(id),
  source_row integer,
  idempotency_key text,
  classification text,
  rejection_reason text,
  raw jsonb NOT NULL,
  PRIMARY KEY (import_run_id, source_row),
  UNIQUE (idempotency_key)
);
