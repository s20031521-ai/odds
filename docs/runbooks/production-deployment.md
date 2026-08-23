# Production Deployment Runbook — odds-tool

Stack: `postgres` + `api` + `caddy` + `cloudflared` + `collector` on the VM (`118.140.60.206`, SSH port 169, user `hugo`).
Public URL: `https://odds.ballballchu.com.hk` (Cloudflare Tunnel → caddy → api → postgres).
Stack root on the VM: `/opt/odds-tool/` — `compose.yaml`, `build/` (repo copy), `secrets/` (0400 root), `postgres/create-roles.sh`.

**Hard rules**
- Never publish host ports. The tunnel is the only inbound path.
- Never touch the other stacks (`astra`, `store-network-dashboard`, `odds-tool-test`).
- Never delete/disable the `hugo` login, disable SSH password auth, or rotate its password unless the owner explicitly asks.
- Secrets live only under `/opt/odds-tool/secrets/` — never in compose.yaml, CLI args, logs, or chat.
- Docker on this VM ignores secret uid/gid/mode (mounts root-only) — entrypoints read secrets as root, then `setpriv` to uid 1000.

All commands below run on the VM via:
```bash
ssh -i ~/.ssh/astra_vm_ed25519 -p 169 hugo@118.140.60.206
# sudo needs a password; use an askpass helper (create, use, delete):
printf '#!/bin/sh\nprintf "%%s\\n" "<sudo password>"\n' > /tmp/.ap.sh && chmod +x /tmp/.ap.sh
export SUDO_ASKPASS=/tmp/.ap.sh
# ... work ...
rm -f /tmp/.ap.sh
```

---

## 1. Deploy procedure

Order: **postgres → roles/migrations → api/caddy → smoke → collector → cloudflared**.

```bash
cd /opt/odds-tool

# 0. Sync code: scp changed files into /opt/odds-tool/build/ (tarball or
#    per-file scp; the build context is ./build on the VM).
# 0b. Stack compose drift: the file actually used is /opt/odds-tool/compose.yaml
#     (build/ has none — compose finds the stack-root file via parent-dir
#     search). It is a copy of deploy/compose.yaml with both build contexts
#     rewritten to `context: ./build`. Whenever deploy/compose.yaml changes
#     (build args, env, services), re-sync it:
#       sed 's|context: \.\.|context: ./build|g' deploy/compose.yaml > /tmp/compose.yaml.new
#       sudo install -m 0644 -o root -g root /tmp/compose.yaml.new /opt/odds-tool/compose.yaml
#     deploy-now.ps1 hard-fails when the stack compose lacks the build-stamp args.

# 1. Validate
sudo -A docker compose config --quiet && echo CONFIG-OK

# 2. Build (digest-pinned bases; api image is shared by api + collector)
sudo -A docker compose build api caddy

# 3. Database first
sudo -A docker compose up -d postgres
sudo -A docker compose ps            # wait for odds-tool-postgres-1 healthy

# 4. Roles (idempotent; converges passwords + grants incl. sequences)
sudo -A sh /opt/odds-tool/postgres/create-roles.sh

# 5. Migrations (one-shot, migration role — never in the api container)
sudo -A docker run --rm --network odds-tool_db_net \
  -e DATABASE_URL="postgres://odds_migration:$(sudo -A cat secrets/pg_migration_password)@postgres:5432/odds" \
  -v /opt/odds-tool/app:/app:ro -v /opt/odds-tool/migrate-deps:/migrate-deps:ro \
  --entrypoint node odds-tool-api:latest db/migrate.mjs
# (only needed when db/migrations/ gained a new file; ledger: table schema_migrations)

# 6. App tier
sudo -A docker compose up -d api caddy

# 7. Smoke (see §2) — only when green:
sudo -A docker compose up -d collector cloudflared
```

Per-service update (no `--no-deps` surprises): `sudo -A docker compose up -d --no-deps <service>`.

---

## 2. Readiness checks

```bash
# Containers
sudo -A docker ps --filter name=odds-tool --format '{{.Names}} {{.Status}}'
# expect: postgres/api/caddy (healthy), collector + cloudflared Up

# Internal readiness (must NOT be reachable through caddy)
sudo -A docker run --rm --network odds-tool_app_net --entrypoint node odds-tool-api:latest \
  -e "const q=async(u)=>{try{const r=await fetch(u);console.log(u,r.status)}catch(e){console.log(u,'ERR')}};await q('http://api:8787/internal/health/ready');await q('http://caddy/internal/health/ready');await q('http://caddy/api/v1/session');"
# expect: api 200 {"ok":true,...} / caddy 404 / session 200 {"authenticated":false}

# Public smoke (from any machine)
curl -s -o /dev/null -w "%{http_code}\n" https://odds.ballballchu.com.hk/                    # 200
curl -s -o /dev/null -w "%{http_code}\n" https://odds.ballballchu.com.hk/api/v1/results     # 401
curl -s -o /dev/null -w "%{http_code}\n" https://odds.ballballchu.com.hk/internal/health/ready  # 404
curl -sI https://odds.ballballchu.com.hk/ | grep -ci "strict-transport-security"            # >=1

# Tunnel
sudo -A docker logs odds-tool-cloudflared-1 2>&1 | grep -c "Registered tunnel connection"   # 4

# Collector quota (paid provider)
sudo -A docker exec odds-tool-postgres-1 psql -U postgres -d odds -tAc \
  "SELECT state::text FROM collector_state WHERE state_key='hdc-collector';" | grep -oE '"quotaRemaining": *[0-9]+'
# expect: > 50 (collector refuses to spend below a 50-credit reserve)
```

---

## 3. Logs

```bash
sudo -A docker compose logs --tail=100 <service>     # postgres|api|caddy|collector|cloudflared
sudo -A docker compose logs -f collector
```
All services log to json-file with `max-size: 10m, max-file: 3` (≈30 MB per service cap).

---

## 4. Rollback

**Kill-switch first (exposure):** if the problem is security/exposure-related, cut traffic before anything else:
```bash
sudo -A docker compose stop cloudflared        # site goes dark (Cloudflare 10xx), stack intact for diagnosis
# or in the Cloudflare dashboard: delete/disable the public hostname
```

**App rollback (tested procedure — rehearsed 2026-07-19, see task-7 report):**
```bash
# Before every deploy, tag the current good image as the rollback point:
sudo -A docker tag odds-tool-api:latest odds-tool-api:rollback
sudo -A docker tag odds-tool-caddy:latest odds-tool-caddy:rollback

# Roll back:
sudo -A docker tag odds-tool-api:rollback odds-tool-api:latest
sudo -A docker compose up -d --no-deps --force-recreate api collector
sudo -A docker tag odds-tool-caddy:rollback odds-tool-caddy:latest
sudo -A docker compose up -d --no-deps --force-recreate caddy
# Verify per §2, then roll forward again by re-tagging the new image.
```

**Database:** migrations are **never reversed blindly**. If the previous image is incompatible with the current schema, restore the verified pre-deploy backup per the migration runbook (Phase 3 adds scheduled Restic backups; until then the pre-deploy restore point is a `pg_dump`):
```bash
sudo -A docker exec odds-tool-postgres-1 pg_dump -U postgres -d odds -Fc > /opt/odds-tool/backups/odds-$(date +%F).dump   # take BEFORE deploys
sudo -A docker exec -i odds-tool-postgres-1 pg_restore -U postgres -d odds --clean --if-exists < <dump>                    # restore (traffic off first)
```

---

## 5. Secret rotation

| Secret | Procedure |
|---|---|
| `pg_app_password` / `pg_migration_password` | `ALTER ROLE <role> PASSWORD '<new>'` via psql first, then write the new file (stdin, `sudo install -m 0400 -o root -g root /dev/stdin secrets/<name>`), `sudo -A docker compose up -d --force-recreate api collector` (app pw) |
| `pg_postgres_password` | `ALTER ROLE postgres PASSWORD …`, new file, `up -d --force-recreate postgres` (volume keeps data; superuser pw comes from the file only at init — keep file and role in sync manually) |
| `session_secret` | New file, `up -d --force-recreate api`. **Invalidates all sessions** (owners must log in again). |
| `odds_api_keys` / `api_football_key` | New file (`odds_api_keys` is the comma-separated `ODDS_API_KEYS` pool), `up -d --force-recreate collector` |
| `cloudflared.env` | New `TUNNEL_TOKEN=…`, `up -d --force-recreate cloudflared` |

Owner password: re-run `scripts/create-owner.mjs` in a one-shot container with `OWNER_USERNAME` + `OWNER_PASSWORD_FILE` (see task-4 report), then delete the password file.

---

## 6. Failure playbook (quick)

| Symptom | First moves |
|---|---|
| Public 502/Cloudflare 1033 | `docker logs odds-tool-cloudflared-1` — dashboard public hostname must be `http://caddy:80`; caddy healthy? |
| Login 401 for everyone | api up? `session_secret` rotated accidentally? |
| API 401 but password correct | throttle (429 after 5 failures, 30 min): `DELETE FROM login_attempts;` |
| Collector silent | it logs only on errors/state — check `collector_state.updated_at`; quota below 50 means it is correctly refusing to spend |
| DB down | `docker compose up -d postgres`; pgdata volume persists; never `down -v` |
