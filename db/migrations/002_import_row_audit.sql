ALTER TABLE import_rows
  DROP CONSTRAINT IF EXISTS import_rows_idempotency_key_key;

ALTER TABLE import_rows
  ADD COLUMN record_kind text;

UPDATE import_rows
SET record_kind = CASE WHEN classification = 'result' THEN 'result' ELSE 'snapshot' END
WHERE record_kind IS NULL;

ALTER TABLE import_rows
  ALTER COLUMN record_kind SET NOT NULL,
  ADD CONSTRAINT import_rows_record_kind_valid
    CHECK (record_kind IN ('snapshot', 'result'));

CREATE INDEX import_rows_idempotency_key_idx
  ON import_rows (idempotency_key);
