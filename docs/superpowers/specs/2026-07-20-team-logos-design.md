# 球隊 Logo 設計(極簡 + 專業 mode)

日期:2026-07-20
狀態:待實作

## 目標

Dashboard 兩個 mode(極簡 + 專業)每張卡嘅主/客隊名隔籬,顯示嗰隊嘅 logo(24px 圓形);搵唔到 logo 嘅隊用 initials 徽章 fallback,版面唔會穿崩。

## 背景

現時系統冇任何球隊 logo 資料,`BuyOpportunity` 淨係有隊名文字(`homeTeam`/`awayTeam` 英文 canonical,`homeTeamZh`/`awayTeamZh` 中文顯示名)。Owner 有 API-Football key(`.env.local` 嘅 `API_FOOTBALL_KEY`),其免費 CDN(`media.api-football.com/football/teams/{id}.png`)提供球隊 logo。

## 架構(方案 A:本地 script 產生靜態 JSON)

```
scripts/build-team-logos.mjs (本地跑,讀 .env.local 嘅 API_FOOTBALL_KEY)
  ↓ 掃 data/ 同 public/ 入面近期 fixtures 嘅主客隊英文名
  ↓ 逐隊 GET https://v3.football.api-sports.io/teams?search=<隊名>(~100ms 間隔)
  ↓ idempotent:已有 entry 唔重查;--refresh 先全部重查
public/team-logos.json  ← commit 落 git,跟 code deploy
      ↓
App.tsx fetch /team-logos.json 一次 → 逐層傳 props 落 DashboardPage
      ↓
TeamLogo component(SimpleDashboard + BuyDashboard 共用)
```

- 前端 runtime 零 API call、零 quota 風險;mapping 可以人工 review 兼 commit。
- API key 只留喺本地 `.env.local`,唔上 VM。

## `public/team-logos.json` 格式

```json
{
  "generatedAt": "2026-07-20T00:50:00Z",
  "teams": {
    "Arsenal": { "id": 42, "logo": "https://media.api-football.com/football/teams/42.png" },
    "Chelsea": { "id": 49, "logo": "https://media.api-football.com/football/teams/49.png", "needsReview": true }
  }
}
```

## Matching 規則

- 搜尋結果第一個 + API 返回嘅 `name` 同我哋隊名 **exact match(不分大小寫)** → 直接採用。
- 第一個結果名唔完全一致(例如 `Arsenal` vs `Arsenal FC`)→ 照用但標 `"needsReview": true`,owner 肉眼核對。
- 搜尋冇結果 → 唔寫入 JSON(前端 fallback 徽章)。
- 前端 lookup 用**英文 canonical 名**(`homeTeam`/`awayTeam`)做 key;中文名只係 display,唔做 key。
- Script 失敗(網絡/quota)記低並繼續,唔會閃退;exit code 維持 0 除非冇任何 entry 寫成。

## UI 規格

- 新 `src/components/TeamLogo.tsx`:props `{ teamName: string; logos: TeamLogoMap; }`。
  - mapping 有 → `<img>`:24×24、`border-radius: 50%`、`loading="lazy"`、`alt=""`(避免讀屏重複隊名)。
  - mapping 冇 → initials 徽章:24×24 圓,取隊名頭兩個 word 嘅首字母大寫(例 `Manchester United` → `MU`);單字隊名取頭兩個字母(例 `Arsenal` → `AR`)。底色由隊名 hash 揀固定色板一隻(`--color-primary` / `--color-positive` / `--color-warning` / `--color-muted`),同一隊永遠同一色。
- 擺位:兩個 mode 每張卡嘅 `<h2>` 入面,主隊名前 + 客隊名後各一個,flex 對齊;手機版照現有縮排。
- `TeamLogoMap` type:`Record<string, { id: number; logo: string; needsReview?: boolean }>`。
- `App.tsx` fetch `/team-logos.json`;fetch 失敗/未 load 完 → 空 map,全部用徽章,唔會阻住 render。
- `BuyDashboard` 同 `SimpleDashboard` 都加 `logos` prop(今次 feature 明確需要改 BuyDashboard,上次嘅「唔准改」constraint 唔再適用於呢個 feature)。

## 測試

- `src/components/TeamLogo.test.tsx`:有 mapping 出 `<img>` 啱 URL 同 24px;冇 mapping 出徽章;initials 計法(兩字隊 `MU`、單字隊 `AR`);同色隊同色(同 input 同 output)。
- 兩個 dashboard 測試更新:傳 `logos` prop,斷言有 mapping 嘅隊出 `<img>`、冇嘅出徽章。
- `scripts/build-team-logos.test.mjs`(`node:test`,跟現有 `scripts/*.test.mjs` pattern,mock fetch):
  - exact match 直接採用、唔標 needsReview
  - 近似名標 `needsReview: true`
  - 冇結果唔寫入
  - idempotent:已有 entry 唔再叫 API
  - API 失敗記低繼續、唔閃退
- 收工前全套 `vitest run` + `node --test scripts/` 相關測試 + `tsc --noEmit` + `vite build` 全綠。

## Deploy

同 2026-07-19 次一樣:本地跑 script 產生 JSON → owner 過目 `needsReview` 嘅隊 → commit → 上 VM `/opt/odds-tool/build/` → `pg_dump` 備份 + tag rollback → 重建 caddy → `up -d --no-deps caddy` → runbook §2 smoke checks。

## 範圍外(YAGNI)

- 唔改 server / Postgres / collector;冇新 API endpoint。
- 唔做 fixtures 頁(#/fixtures)嘅 logo(今次淨係 dashboard 兩個 mode)。
- 唔做 logo 自動更新排程;新球隊出現就手動跑多次 script。
- 唔改 3% edge / 買盤邏輯。
