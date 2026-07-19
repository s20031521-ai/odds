# Kimi Handoff — 2026-07-19

> 接手自 `docs/CODEX-HANDOFF-2026-07-18.md`（Codex，Phase 1 完成時）。
> 本文件記錄 2026-07-18 深夜至 2026-07-19 由 Kimi 完成嘅所有工作、系統現況、操作須知同埋教訓。
> 詳細逐項證據：`.superpowers/sdd-production-phase2/progress.md` + `task-0-report.md` 至 `task-7-report.md`。

---

## 1. 系統現況（一句講晒）

**odds-tool 已經正式上線生產：`https://odds.ballballchu.com.hk`** —— 足球賠率價值分析 PWA，單一 owner 登入，React+TS 前端（中文 UI：中文隊名 + 中文聯賽名），Node API，PostgreSQL 數據層，Cloudflare Tunnel 對外（零主機 port），付費 + 免費 collector 自動運行緊。

| 項目 | 狀態 |
|---|---|
| 網站 | `https://odds.ballballchu.com.hk`（200，PWA 可裝） |
| Owner 帳號 | `s20031521`（唯一帳號，密碼 14 位，owner 自選） |
| Stack | postgres / api / caddy / cloudflared / collector 五個 container 全部 healthy |
| 數據 | 96 prediction snapshots、1234 results、live_odds ~170–300 行（浮動）、286 distinct matches、0 settlements |
| 付費 quota | The Odds API `quotaRemaining` 491/500（有 50-credit 保護線 + provider cooldown） |
| 備份 | 手動 pg_dump 一份：`/opt/odds-tool/backups/odds-2026-07-19.dump`（已驗證 10/10 表）—— **冇自動備份（Phase 3 先做）** |

---

## 2. 呢兩日做咗咩（時間線）

### Phase 2：VM 部署（plan：`docs/superpowers/plans/2026-07-19-phase2-vm-deployment.md`，Task 0–7 全部完成）

- **Task 0** — VM 預備：key-only SSH 驗證（`astra_vm_ed25519`）、密碼輪換後按 owner 要求改返、stacks 盤點（`astra`、`store-network-dashboard`、`odds-tool-test` 三個現有 stack 唔掂得）、`/opt/odds-tool` 建立、61 GiB 空間確認。
- **Task 1** — PostgreSQL：digest-pinned `postgres:18-bookworm`，三 networks（`db_net` internal-only、`app_net`、`tunnel_net`），零 published ports。Roles：`odds_app`（CRUD-only）+ `odds_migration`（DDL）。Migrations 001–003 已套用（ledger `schema_migrations`）。
- **Task 2** — api + caddy images：D2-A trusted proxy（`TRUSTED_PROXY_CIDRS=172.16.0.0/12`，左most XFF 只信 Docker bridge pool）、`RUN_MIGRATIONS=false` 開關（TDD）、digest-pinned images。Caddy 用 ordered `handle` blocks（`/internal/*`→404、`/api/v1/*`→proxy、SPA fallback 最尾）。
- **Task 3** — 數據遷移：9 個 archive 檔上 VM（`/opt/odds-tool/migration-bundle-2026-07-19/`，read-only），import ×2（第二次零新增，idempotent 證明），parity `status=ok`（183/853、3 valid-current / 93 legacy / 87 invalid、286 matches、0 settlements），integrity exit 0，hash 前後 byte-identical。
- **Task 4** — Owner bootstrap：`s20031521` 唯一帳號；login/logout/CSRF 矩陣全 PASS；密碼檔用完即刪。
- **Task 5** — 私網 smoke：**29/29 PASS / 0 洩露**（401 矩陣、16KiB/1MiB 上限、Origin/CSRF 403×3、404/405、legacy 404×6、throttle 第 5 次 429）；三個 collector 喺 `--network none` 斷網容器 self-test 全過。
- **Task 6** — 上線：cloudflared digest-pinned（token 用 root-only env_file），4/4 QUIC 接通 HKG edge；公開驗證矩陣全 PASS；exposure audit 零新增監聽 port；**付費 collector 開通**（owner 明確批准「開」）：`collector-entrypoint.sh` 監督 loop（hdc-collector 每 5 分鐘 state-driven + hkjc-import 每 15 分鐘免費 HKJC）。
- **Task 7** — Runbook + rollback 演練：`docs/runbooks/production-deployment.md`；真演練 A→B→A→B→clean 一次過（中間捉到「冇 `cd` 就 `compose up` 會靜默無效」呢個操作陷阱）。

### Phase 2 之後嘅 bug 修復（全部 TDD）

1. **`odds_app` 漏 sequence USAGE** — 第一次 hkjc-import 撞 `permission denied for sequence results_id_seq`；`deploy/postgres/create-roles.sh` 補 `ALTER DEFAULT PRIVILEGES … ON SEQUENCES` + existing objects explicit grants。
2. **collector 降權後 EACCES** — uid 1000 冇權 `mkdir /app/data` `/app/public`；Dockerfile 預建兼 chown。
3. **api image 漏 `src/`** — hdc-collector 運行時用 Vite `ssrLoadModule("/src/oddsApi.ts")`，image 冇包 src/ 就炸；Dockerfile 加 `COPY src/ src/`。
4. **`liveOddsIdentity` 漏 bookmaker** — The Odds API 同一場多莊家撞 `live_odds_identity_key_key`（23505）；identity 加 `|<bookmaker>` 後綴（冇 bookmaker 時維持舊五段格式）。RED 喺 disposable DB 一模一樣重現先至改。

### 三個 UI 功能（owner 要求，全部 TDD + 已上線）

5. **每張卡顯示聯賽名** — HKJC `tournament.name_en/name_ch`、The Odds API `sport_title`；threading：collector → flatten → live payload → Fixture/BuyCandidate → 四種卡（Dashboard + 全部賽事三種）。
6. **中文隊名** — 新欄位 `homeTeamZh`/`awayTeamZh`（HKJC `name_ch`），data 層英文唔郁（matching/identity 靠英文名），render 時 `zh ?? en`。
7. **中文聯賽名** — `leagueZh` 同一條路，`leagueZh ?? league`。

### Incident：Cloudflare 快取舊 service worker

8. 聯賽功能上線後 owner 睇唔到 —— root cause：**Cloudflare 預設快取 `.js`，舊 `sw.js` 派舊 app bundle**。修：caddy 對 `/sw.js` `/registerSW.js` 派 `Cache-Control: no-cache, must-revalidate` + owner 喺 dashboard Purge Everything。以後部署即時生效。

---

## 3. VM 操作須知（最重要，跟足呢啲就唔會出事）

### SSH
```bash
ssh -i ~/.ssh/astra_vm_ed25519 -o BatchMode=yes -p 169 hugo@118.140.60.206
```
Key 已裝好免密碼。**sudo 要密碼**（hugo 唔喺 docker group），做法係 askpass：
```bash
printf '#!/bin/sh\nprintf "%%s\\n" "<sudo密碼>"\n' > /tmp/.ap.sh && chmod +x /tmp/.ap.sh
scp -i ~/.ssh/astra_vm_ed25519 -P 169 /tmp/.ap.sh hugo@<VM>:/tmp/.ap.sh
# VM 上：export SUDO_ASKPASS=/tmp/.ap.sh && sudo -A <command>
# 用完兩邊 rm -f /tmp/.ap.sh
```
⚠️ askpass script **必須有 shebang**；⚠️ `/tmp` 跨 Bash call 唔保留（本機 python 嘅 `/tmp` 同 Git Bash 嘅 `/tmp` 係兩回事，跨步驟檔案放 workspace）。

### Owner 硬性規則（違反即事故）
- **絕對唔好郁 `hugo` 嘅 VM login**：唔好刪帳戶、唔好閂 SSH 密碼登入、唔好 rotate 密碼，除非 owner 明確叫。
- **三個現有 stack 唔掂得**：`astra`、`store-network-dashboard`、`odds-tool-test`（disposable test DB 喺 `127.0.0.1:55432`）。
- **零 published host ports**：對外只有 cloudflared outbound QUIC。
- **Archives immutable**：`data/*.jsonl`、`data/*.json`、`public/hkjc-odds.json` 郁之前要 sha256 對比。
- **模型紅線**：四個模型 0/30 settled distinct matches，唔准調 weights 或 3% threshold。
- **Result priority**：FOTMOB 40 > API-Football 30 > HKJC historic 20 > live 10 > legacy 0。

### 呢部 Docker 嘅怪癖（已繞過，唔好「修正」返）
- **Secrets 嘅 uid/gid/mode 被無視**（mount 落嚟係 root-only）—— 所以 (1) roles 唔用 initdb.d，用 `deploy/postgres/create-roles.sh`（idempotent）；(2) api/collector entrypoint 係 root 啟動讀 secrets 再 `setpriv --reuid=1000 --regid=1000 --init-groups` 降權。
- **`docker compose` 命令一定要 `cd /opt/odds-tool` 先跑**（rollback 演練實測：冇 cd 會 `no configuration file provided` 兼靜默無效）。

### Stack 佈局
```
/opt/odds-tool/
├── compose.yaml          # VM 版（build context 係 ./build；repo 版 deploy/compose.yaml 用 ..）
├── build/                # repo copy（改嘢要雙向同步！）
├── secrets/              # 0400 root:root
├── postgres/create-roles.sh
├── migration-bundle-2026-07-19/   # read-only archive 副本
└── backups/odds-2026-07-19.dump
```
**本地 ↔ VM 同步**：改完本地檔案要 scp 上 `/opt/odds-tool/build/` 對應位置；compose 要用 `sed 's|context: \.\.|context: ./build|'` 轉換先放上 `/opt/odds-tool/compose.yaml`。

### Secrets（6+1 個，全部 0400 root，值從未入過 image/log）
`pg_postgres_password` / `pg_app_password` / `pg_migration_password` / `session_secret`（隨機 48-hex，VM 上產生）+ `odds_api_key` / `api_football_key`（owner 提供）+ `cloudflared.env`（`TUNNEL_TOKEN=…`，cloudflared 只食 env/CLI 所以唔係 Compose secret）。Rotation 程序：runbook §5。

---

## 4. 架構速查

```
Internet → Cloudflare edge (HTTPS) → cloudflared (tunnel_net, outbound QUIC)
  → caddy:80 (tunnel_net+app_net)     # handle blocks: /internal/*→404, /api/v1/*→proxy, /api/*→404, legacy→404, SPA fallback
  → api:8787 (app_net+db_net)         # setpriv uid 1000；TRUSTED_PROXY_CIDRS=172.16.0.0/12；RUN_MIGRATIONS=false
  → postgres:5432 (db_net internal)   # roles: odds_app(CRUD) / odds_migration(DDL)
collector (app_net+db_net)            # 同一 api image；每 5min hdc-collector（state-driven，閒置零 call）+ 每 15min hkjc-import（免費）
```

- **Routes**：`POST /api/v1/auth/login|logout`、`GET /api/v1/session`、`GET /api/v1/odds/live|results|backtest`（auth）、`POST /api/v1/predictions`（auth+CSRF）、`GET /internal/health/ready`（私網 only）。Cookie：`__Host-odds_session; Path=/; Secure; HttpOnly; SameSite=Strict`。CSRF：`x-csrf-token` header。Throttle：5 次 fail → 429 30 分鐘。
- **Images**：全部 digest-pinned；api image 俾 api + collector 共用；caddy image 內嵌 PWA `dist/` + Caddyfile——**前端改動要重建 caddy，collector/ server 改動要重建 api**。
- **Rollback**：`docker tag odds-tool-api:rollback odds-tool-api:latest && cd /opt/odds-tool && sudo -A docker compose up -d --no-deps --force-recreate api collector`（caddy 同理）。Kill-switch：`docker compose stop cloudflared`。

---

## 5. 開發/測試流程

- 本機**冇 `npm`**，要用 `npm.cmd`；本機冇 docker。
- **TDD 係呢個 repo 嘅紀律**：新行為先寫 failing test。
- DB 測試用 disposable DB：`ssh -i ~/.ssh/astra_vm_ed25519 -o BatchMode=yes -f -N -L 127.0.0.1:55432:127.0.0.1:55432 -p 169 hugo@<VM>`（會斷，用前檢查重開），然後 `DATABASE_URL="postgresql://odds_test:odds_test@127.0.0.1:55432/odds_test" node --test …`。
- 前端：`npm.cmd run test`（Vitest）、`npm.cmd run build`；collector：`node scripts/<x>.mjs --self-test`。
- 混合 CRLF/LF 檔案（`src/odds.ts`、`src/App.tsx`、`src/styles.css`）：Edit tool 會 match 唔到，用 assertion-guarded Python replacement。
- Repo **冇 git metadata**，file 係唯一 source of truth；進度記錄喺 `.superpowers/sdd-production-phase2/progress.md`。

---

## 6. 未做 / 可選（按優先順序）

1. **自動備份（Phase 3）**— Restic 加密去 S3-compatible + 每日排程 + restore 演練。Owner 2026-07-19 話「唔一定要」，依家只靠手動 pg_dump（runbook §4 有指令）。
2. **VM provider 快照** — owner 去控制台撳，一分鐘嘅事。
3. **閂 SSH 密碼登入** — key-only 已驗證可用；owner 未批，冇郁。
4. **Cloudflare Access** — 可選加多層驗證。
5. **Phase 3 其他**：private GitHub + CI + GHCR + image scanning。
6. **Known minor**：完場/歷史版未中文化（result entries 冇中文資料）；the-odds-api 行嘅 `leagueZh` 永遠係英文（冇中文來源，by design）。

## 7. 快速健康檢查（接手第一件事跑呢啲）

```bash
# Stack
ssh -i ~/.ssh/astra_vm_ed25519 -p 169 hugo@<VM> 'export SUDO_ASKPASS=/tmp/.ap.sh; sudo -A docker ps --filter name=odds-tool --format "{{.Names}} {{.Status}}"'
# 公開
curl -s -o /dev/null -w "%{http_code}\n" https://odds.ballballchu.com.hk/                    # 200
curl -s -o /dev/null -w "%{http_code}\n" https://odds.ballballchu.com.hk/api/v1/results     # 401
# Quota（要 >50）
sudo -A docker exec odds-tool-postgres-1 psql -U postgres -d odds -tAc \
  "SELECT state::text FROM collector_state WHERE state_key='hdc-collector';" | grep -oE '"quotaRemaining": *[0-9]+'
# Collector 有冇持續寫（updated_at 應該係近 15 分鐘內）
sudo -A docker exec odds-tool-postgres-1 psql -U postgres -d odds -tAc "SELECT state_key, updated_at FROM collector_state;"
```
