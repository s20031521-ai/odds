# Handoff — 球隊 Logo 功能 + 自動部署(2026-07-21)

> 上一份:[MASTER-HANDOFF-v1.0.0.md](MASTER-HANDOFF-v1.0.0.md)(Phase 2 VM deployment)。
> 呢份覆蓋 2026-07-20 至 2026-07-21 嘅球隊 logo feature、三次 production deploy、stale service worker 事故,以及「每日補 logo + 自動上 production」定時任務。

## 1. 背景同目標

Owner 要求：喺賠率 dashboard 每隊隊名隔籬顯示該隊 logo。Logo 要 **self-hosted 喺 server**(`public/team-logos/*.png`),唔係每次由 client 向第三方 CDN 攞。資料來源：API-Football `/teams?search=`(free plan,100 calls/day,10 calls/min)。

## 2. 改動一覽(master,時間序)

| Commit | 內容 |
|---|---|
| `50bd070` | `scripts/build-team-logos.mjs` 加 `--max-calls` quota guard;npm alias `logos:build` |
| `4f1d6c1` | Logo batch 1(8 隊；當日 API quota 盡) |
| `a1d0312` | 每日批次(定時任務首次跑,+67 隊,包含按開波時間優先補嘅顯示中隊伍) |
| `2dd6db5` | 修正 AGF Aarhus 錯配女子隊(→男子隊 id 406);移除 Ararat-Armenia 錯配 |
| `4acbf7a` | **全部賽事頁四種卡(主客和/大細波/角球/亞洲讓球)加 TeamLogo** |

Feature 早期 commits(UI 極簡/專業 mode、TeamLogo component、manifest 機制)喺 2026-07-19 至 20 經 superpowers SDD 流程完成,詳見 `docs/superpowers/plans/2026-07-20-team-logos.md` 同 `.superpowers/sdd-production-*` ledger。

## 3. 架構重點

- **產生**:`scripts/build-team-logos.mjs` 掃 `public/` 同 `data/` JSON 入面嘅 `homeTeam`/`awayTeam`,逐隊 search API-Football,下載 PNG 落 `public/team-logos/<apiId>.png`,更新 `public/team-logos.json` manifest(`{ name: { id, logo, needsReview? } }`)。Idempotent:已有 entry 唔會重查。
- **前端**:`App.tsx` fetch `/team-logos.json` 入 state,傳 `logos` prop 落 `DashboardPage`(值得買)同全部賽事頁各 card。`TeamLogo` 用 **英文名**(`opportunity.homeTeam`)做 lookup,顯示名係中文(`homeTeamZh`)— 兩者獨立,唔會互相影響。搵唔到就顯示 initials 徽章。
- **Serving**:Vite 將 `public/` copy 入 dist,Caddy `file_server` 直接派,唔經 API。

## 4. Production deploy(三次,全部成功)

Runbook:`docs/runbooks/production-deployment.md`。流程已驗證三次:

1. 本地 `tar`(exclude `node_modules/.git/data/dist/test-results/.env.local/.superpowers/webbridge-req-*`)→ `scp -P 169` 上 VM `/tmp/`
2. VM(ssh `-p 169 -i ~/.ssh/astra_vm_ed25519 hugo@118.140.60.206`,sudo 用 askpass 臨時檔):解包 → `rsync -a --delete` 入 `/opt/odds-tool/build/` → `pg_dump -U postgres -Fc odds` 備份入 `/opt/odds-tool/backups/` → `docker tag odds-tool-{api,caddy}:latest ...:rollback`
3. `docker compose config --quiet && build caddy && up -d --no-deps caddy`(純前端改動淨係郁 caddy)
4. Smoke:caddy healthy;內部 api 200 / caddy 404 / caddy session 200;tunnel 4 條;公開首頁 200、`/api/v1/results` 401、`/internal/*` 404、HSTS ≥1;新 JS asset grep 到 feature 字串;`team-logos.json` 隊數 = 本地 manifest 隊數
5. 清臨時檔(VM `/tmp/.ap.sh`、tarball、`/tmp/odds-sync`;本地 tarball)

硬規矩(繼續適用):never publish host ports;唔准郁 `astra`、`store-network-dashboard`、`odds-tool-test` 等鄰居 stack;唔准 `down -v`;secrets 淨係喺 `/opt/odds-tool/secrets/`。

## 5. ⚠️ Stale Service Worker 事故(重要教訓)

**症狀**:Deploy 成功、server 檔案齊,但 owner 睇唔到新功能(一張 logo 都冇),頁面仲載入緊**舊 bundle hash**。

**根因**:PWA(workbox precache + `registerType: "autoUpdate"`)。7 月 19 號前嘅舊 SW 已 cache 死喺 client,而嗰時 `sw.js` 係 HTTP-cacheable — browser 嘅 SW update check 用 HTTP cache 攞到舊 `sw.js`,永遠唔會更新。Caddyfile 其實已加咗 `@pwaSw Cache-Control "no-cache, must-revalidate"`(7 月 19 號事故後),但**救唔到已經中咗招嘅 client**。

**修復**(喺 client 做一次):`navigator.serviceWorker.getRegistrations()` → unregister 全部 + `caches.delete()` 全部 → reload。之後新 SW 正常 autoUpdate。

**教訓**:
- 每次前端 deploy 後,如果 owner 話「睇唔到改動」,先查 SW(`document.querySelector('script[type=module]').src` 對比 server asset hash)。
- 其他裝置(手機 PWA)可能同樣中招,要關晒再開或 clear app data 一次。
- 診斷用咗 kimi-webbridge 直接睇 owner 嘅 browser,好使。

## 6. 定時任務:每日補 logo + 自動 deploy

- Automation ID `automation_1dbf8f50-40cd-4dcf-b007-a16b2c452f41`,cron `17 9 * * *`(Asia/Hong_Kong),local_conversation,完成後 desktop 通知。
- 流程:`build-team-logos.mjs --max-calls 85` → 有新嘢就 commit → **自動跟第 4 節流程 deploy(淨係 caddy)** → smoke → 回覆報告 + needsReview 名單。
- **注意**:sudo 密碼以 askpass 形式寫咗喺 automation prompt 入面(存喺本機 automation state 檔)。Owner 已知悉密碼曾喺 chat 出現;rotate 與否由 owner 決定,rotate 後要更新 automation prompt。
- 已知限制:script 內部 sleep 係 120ms,會撞 per-minute 10 calls 限制(429 後該隊記為 miss,浪費 call)。**建議後續改做 7 秒**(要同步改 `build-team-logos.test.mjs`),未改。

## 7. 現況同待辦

**覆蓋**:manifest 75 隊(2026-07-21 10:00)。顯示中賽事大部分有 logo;未覆蓋嘅顯示 initials 徽章。

**needsReview(31 隊,待 owner 核對)**:
AGF Aarhus, APIA Leichhardt, Athletic Club MG, Athletico Paranaense, Cumberland Utd, Djurgardens, FC Lahti, FCI Levadia, Fenerbahce, Goteborg, Hearts, Heidelberg Utd, IFK Mariehamn, Incheon Utd, Inverness, Jeju SK, Kalmar, Kauno Zalgiris, Lincoln Red Imps, Lions FC, Malmo, Mjallby, Orgryte, Sabah FC, Sporting, St. Johnstone, St. Mirren, Sydney FC, Thun, Ulsan HD, Örgryte IS

**確認搵唔到(API 冇 data)**:
- 女子隊(免費 plan 冇女子聯賽):Algeria Women, Burkina Faso Women, Cameroon Women, Cape Verde Islands Women, Cote d'Ivoire Women, Egypt Women, Ghana Women, Kenya Women, Malawi Women, Mali Women, Morocco Women, Newell's Old Boys Women, Nigeria Women, Senegal Women, South Africa Women, Tanzania Women, Union Santa Fe Women, Zambia Women, Corinthians Women, Cruzeiro Women, Ferroviaria Women, Fluminense Women 等
- Ararat-Armenia(API 搵唔到;曾錯配 FC Ararat Yerevan,已移除)
- 長遠要補女子隊logo,需要升級 API-Football plan 或另搵 source。

**Alias 成功例子**(改名隊,用替代名搵到):Jeju SK→Jeju United FC(2761)、Ulsan HD→Ulsan Hyundai FC(2767)、Incheon Utd→Incheon United(2763)、St. Mirren→ST Mirren(251)、St. Johnstone→ST Johnstone(258)、FC Lahti/Örgryte IS 同英文名共享同一 PNG。

**待辦**:
1. Owner 核對 needsReview 31 隊(唔啱嘅話改 `public/team-logos.json` 對應 id 再 deploy)。
2. 每日 09:17 定時任務續補剩餘 ~60 隊 + 自動 deploy,預計 1-2 日補齊(女子隊除外)。
3. (建議)`build-team-logos.mjs` sleep 120ms → 7s,避免 per-minute 429 浪費 call。
4. (建議)Owner 考慮 rotate VM sudo 密碼;rotate 後更新 automation prompt。
5. 一次性 script `scripts/tmp-priority-logos.mjs`、`scripts/tmp-alias-logos.mjs` 同 `data/priority-*.txt/json` 未入 git,留低聽日優先補新顯示賽事用,補齊後可刪。

## 8. 常用指令速查

```bash
# 本地測試(npm/npx 唔喺 PATH)
node node_modules/vitest/vitest.mjs run
node node_modules/typescript/bin/tsc --noEmit

# 補 logo(每日 quota 100,per-minute 10)
node scripts/build-team-logos.mjs --max-calls 85

# 查 production 而家顯示緊嘅隊
ssh -p 169 -i ~/.ssh/astra_vm_ed25519 hugo@118.140.60.206 \
  'sudo docker exec odds-tool-postgres-1 psql -U postgres -d odds -t -A -c \
   "SELECT DISTINCT t FROM (SELECT home_team AS t FROM live_odds WHERE expires_at > now() \
    UNION SELECT away_team FROM live_odds WHERE expires_at > now()) s ORDER BY t"'

# 驗證 production manifest 隊數
curl -s https://odds.ballballchu.com.hk/team-logos.json | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(Object.keys(JSON.parse(d).teams).length))"
```
