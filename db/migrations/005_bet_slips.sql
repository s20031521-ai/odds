CREATE TABLE bet_slips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES owners(id),
  fixture_id uuid REFERENCES fixtures(id),
  match_id text,
  sample_id integer,
  home_team text,
  home_team_zh text,
  away_team text,
  away_team_zh text,
  commence_time timestamptz,
  market text NOT NULL,
  selection text NOT NULL,
  line numeric,
  odds numeric NOT NULL,
  stake numeric NOT NULL CHECK (stake > 0),
  settlement text NOT NULL DEFAULT 'pending',
  settled_at timestamptz,
  source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_bet_slips_owner_created ON bet_slips (owner_id, created_at DESC);
CREATE INDEX idx_bet_slips_owner_fixture ON bet_slips (owner_id, fixture_id);
CREATE INDEX idx_bet_slips_owner_settlement ON bet_slips (owner_id, settlement);
CREATE INDEX idx_bet_slips_fixture_market ON bet_slips (fixture_id, market) WHERE fixture_id IS NOT NULL;
