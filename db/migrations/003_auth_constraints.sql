ALTER TABLE owners
  ADD CONSTRAINT owners_username_normalized CHECK (
    username = lower(btrim(username)) AND length(username) > 0
  ),
  ADD CONSTRAINT owners_password_hash_approved CHECK (
    password_hash ~ '^\$argon2id\$v=19\$m=19456,t=2,p=1\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$'
  );

CREATE UNIQUE INDEX owners_singleton_idx ON owners ((true));

ALTER TABLE sessions
  ALTER COLUMN owner_id SET NOT NULL,
  ALTER COLUMN created_at SET NOT NULL,
  ALTER COLUMN last_seen_at SET NOT NULL,
  ALTER COLUMN idle_expires_at SET NOT NULL,
  ALTER COLUMN absolute_expires_at SET NOT NULL,
  ADD CONSTRAINT sessions_token_hash_length CHECK (octet_length(token_hash) = 32),
  ADD CONSTRAINT sessions_csrf_hash_length CHECK (octet_length(csrf_hash) = 32),
  ADD CONSTRAINT sessions_time_order CHECK (
    created_at <= last_seen_at
    AND last_seen_at <= idle_expires_at
    AND idle_expires_at <= absolute_expires_at
  );

CREATE INDEX sessions_owner_id_idx ON sessions (owner_id);

ALTER TABLE login_attempts
  ALTER COLUMN failed_count SET NOT NULL,
  ALTER COLUMN window_started_at SET NOT NULL,
  ADD CONSTRAINT login_attempts_scope_key_digest CHECK (scope_key ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT login_attempts_failed_count CHECK (failed_count >= 0),
  ADD CONSTRAINT login_attempts_time_order CHECK (
    blocked_until IS NULL OR blocked_until >= window_started_at
  );
