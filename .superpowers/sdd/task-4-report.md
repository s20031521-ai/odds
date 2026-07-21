# Task 4 Report: `MatchAnalysisPage`

Branch: `today-first-phase-b`
Commit: `9e43462 feat: MatchAnalysisPage with picker and not-found states`

## 做咗咩

- **`src/pages/MatchAnalysisPage.test.tsx`**（新增）— 逐字跟 brief Step 1：3 個測試（完整頁 / picker / not-found），用 `renderToStaticMarkup`，無斷言具體時間字串（brief Step 5 註明係特意）。
- **`src/pages/MatchAnalysisPage.tsx`**（新增）— 逐字跟 brief Step 3：
  - `matchId === null` → picker：`Mascot pose="chiikawa-empty"` + 「由今日或賽程揀一場波」+ `uniqueMatches` dedupe by matchId 嘅 quick links（`#/analysis?match=<encoded>`，「主 vs 客 · 開賽時間」）。
  - `matchId` 有但 `header`/`details` null → 「搵唔到呢場波 — 可能已開賽或已下架」+ `href="#/analysis"`「揀返另一場 →」。
  - 齊料 → header（雙 `TeamLogo` + 「主 vs 客」+ `formatKickoff(commenceTime)` + 聯賽 +「轉場」link）→ 固定次序四張 `MarketDetailCard`（主客和 / 大細波 / 角球 / 亞洲讓球）→ 尾行「賠率同步於 {generatedAt ?? "未有成功同步"}」。
- **`src/styles/match.css`**（Edit 追加，現有卡面樣式未動）— 按 brief Step 4 骨架加頁面級樣式：`.match-analysis__header .page-heading`、`.match-analysis__meta`、`.match-analysis__picker`（`list-style: none`）、`.match-analysis__picker a`（`display: block; min-height: var(--touch-target)`）、`.match-analysis__sync` / `.match-analysis__back`（muted 細字置中）。brief 嘅 CSS 骨架得 comments，具體值跟 `tokens.css` / `today.css` 慣例填（`--color-surface` / `--color-border` / `--radius-card` / `--shadow-soft` / `--color-muted`）。

## 測試結果（逐字摘要）

Step 2（實裝前，預期 fail）：
```
 FAIL  src/pages/MatchAnalysisPage.test.tsx [ src/pages/MatchAnalysisPage.test.tsx ]
Error: Cannot find module './MatchAnalysisPage' imported from C:/Users/itadmin/Documents/賭/src/pages/MatchAnalysisPage.test.tsx
 Test Files  1 failed (1)
      Tests  no tests
```

Step 5（實裝後）：
```
 ✓ src/pages/MatchAnalysisPage.test.tsx (3 tests) 8ms
 Test Files  1 passed (1)
      Tests  3 passed (3)
```

全測試（regression check）：
```
 Test Files  38 passed (38)
      Tests  245 passed (245)
```

## tsc 結果

`node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` → exit 0，無輸出。

## Self-review

- ✅ TDD 順序：先寫測試 → 確認 fail（module not found）→ 實裝 → pass → tsc → commit。
- ✅ 測試同實裝 code 逐字跟 brief，無自由發揮。
- ✅ 紅線無掂：`src/matchDetails.ts`、`src/components/MarketDetailCard.tsx`、`src/pages/BuyDashboard.tsx`、模型檔全部未修改（commit 只含 3 個檔：`MatchAnalysisPage.tsx`、`.test.tsx`、`match.css`）。
- ✅ `match.css` 用 Edit 喺尾追加，Task 3 嘅 `.market-detail-grid` / `.market-detail-card*` 樣式原封不動。
- ✅ 測試無斷言 `formatKickoff` 具體輸出（timezone 安全）。
- ✅ YAGNI：無加 spec 以外嘅 state / 功能；`uniqueMatches` 只係 dedupe，無 sorting（spec 無要求）。
- ✅ Commit message 跟 brief Step 6 逐字。

## Concerns

- Brief Step 4 嘅 CSS 骨架得註釋無具體值，我按現有 design tokens 同 today.css 風格填咗（卡面化 picker link、muted meta/footer）。如有設計稿需要微調，屬 cosmetic 層面，唔影響行為同測試。
- Picker quick links 次序跟 `opportunities` 原序（dedupe 後先到先得），spec 無要求按開賽時間排序，故無加（YAGNI）。
