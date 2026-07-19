# Docker secrets for the odds-tool stack

**Never commit real values. Never print them. Never place them in the repo, logs, chat, or reports.**

Each secret is a single file under `/opt/odds-tool/secrets/` on the VM, mode `0400`, owner `root:root`. Compose reads them via relative paths (`./secrets/<name>`) from `/opt/odds-tool/compose.yaml`; only the services that declare a secret receive it under `/run/secrets/`.

| Secret file | Used by | Created in |
|---|---|---|
| `pg_postgres_password` | postgres superuser bootstrap | Task 1 |
| `pg_app_password` | `odds_app` role (api / collector runtime) | Task 1 |
| `pg_migration_password` | `odds_migration` role (DDL) | Task 1 |
| `session_secret` | api auth service | Task 2 |
| `odds_api_key` | collector (paid provider) | Task 5/6 |
| `api_football_key` | collector/importer | Task 5/6 |
| `owner_password` | owner bootstrap (deleted after use) | Task 4 |
| `cloudflared.env` | cloudflared (`env_file` holding `TUNNEL_TOKEN=…`; cloudflared only accepts the token via env/CLI, so no Compose secret file) | Task 6 |

## Creation procedure (Task 1 secrets)

Run on the VM (values are generated on the VM and never transit the operator machine in plaintext files):

```bash
for name in pg_postgres_password pg_app_password pg_migration_password; do
  openssl rand -hex 24 | sudo tee /opt/odds-tool/secrets/$name >/dev/null
done
sudo chown root:root /opt/odds-tool/secrets/*
sudo chmod 0400 /opt/odds-tool/secrets/*
```

## Creation procedure (Task 2 secrets)

```bash
openssl rand -hex 24 | sudo tee /opt/odds-tool/secrets/session_secret >/dev/null
sudo chown root:root /opt/odds-tool/secrets/session_secret
sudo chmod 0400 /opt/odds-tool/secrets/session_secret
```

- Random values: `openssl rand -hex 24` (48 hex chars) — no need for humans to know them.
- `owner_password` is human-chosen at bootstrap time and the file is deleted right after.
- `odds_api_key` / `api_football_key` are copied from the operator's local `.env.local` at Task 5 via a one-shot `ssh` write (values never echoed).
- Rotation: write the new value, `docker compose up -d --force-recreate <service>`, then update dependent roles/config if the secret is a database password (`ALTER ROLE ... PASSWORD` first, then the file).
