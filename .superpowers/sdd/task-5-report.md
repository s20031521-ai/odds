# Task 5 Report — `scripts/build-team-logos.mjs`

## 做咗咩

1. **Step 1 — 寫 failing test**:逐字照 brief 建立 `scripts/build-team-logos.test.mjs`(6 個測試,`node:test` + `node:assert/strict`,注入假 `fetchImpl`,全部喺 `os.tmpdir()` 嘅 temp fixture root 度行,零真網絡)。
2. **Step 2 — 確認紅燈**:行測試,fail 於 `ERR_MODULE_NOT_FOUND`(`Cannot find module './build-team-logos.mjs'`),符合預期。
3. **Step 3 — 實作**:逐字照 brief 建立 `scripts/build-team-logos.mjs`,export `collectTeamNames` / `pickTeamResult` / `buildTeamLogos`;CLI 入口用 `isMain` guard,由 `.env.local` 載 `API_FOOTBALL_KEY`,支援 `--refresh`。
4. **Step 4 — 確認綠燈**:行測試,6/6 pass。
5. **Step 5 — Commit**:`34d72fc0ff9320a1639d3f46809aec135c10d523`,淨係 add 咗兩個新檔,冇掂其他 dirty file。

## 指令同測試結果

- `node --test scripts/build-team-logos.test.mjs`(實作前):FAIL — `ERR_MODULE_NOT_FOUND`,符合 brief 預期。
- `node --test scripts/build-team-logos.test.mjs`(實作後):PASS — `tests 6 / pass 6 / fail 0`,duration ~94ms。
  - ✔ collectTeamNames finds unique home/away names across public and data JSON
  - ✔ pickTeamResult adopts exact matches without needsReview
  - ✔ pickTeamResult flags near-name matches for review
  - ✔ pickTeamResult returns null when there are no results
  - ✔ buildTeamLogos writes local-path entries, downloads PNGs and is idempotent
  - ✔ buildTeamLogos skips entries whose logo download fails and keeps going
- Commit:`git add scripts/build-team-logos.mjs scripts/build-team-logos.test.mjs && git commit -m "feat: add team logo builder script (self-hosted PNGs)"` → `34d72fc`(LF→CRLF warning 只係 git autocrlf 提示,無礙)。

## Commit hash

`34d72fc0ff9320a1639d3f46809aec135c10d523`

## Self-review

- ✅ 測試冇真打 API:全部 fetch 經注入 `fakeFetch`,routes 唔命中就 throw `"network down"`;全程冇對外網絡請求。
- ✅ `team-logos.json` 嘅 `logo` 值係本地路徑 `/team-logos/<id>.png`(測試 assert 咗),外部 URL 只喺 download 時用,唔落 JSON。
- ✅ 冇真 key 出現喺測試、日誌、commit:測試用 `"test-key"` 假值;key 只喺 runtime 由 `.env.local` 注入;`x-apisports-key` header 唔會被 log。
- ✅ 冇跑過 `node scripts/build-team-logos.mjs` 本尊 — 真跑(用真 quota)留俾 controller。
- ✅ TDD 次序跟足:fail → 實作 → pass → commit。
- ✅ Idempotent 行為經測試驗證:第二次跑已有 entry 唔再叫 API。
- ⚠️ 注意:repo 有其他未 commit 嘅 dirty file(progress/brief/report md 等),本次 commit 嚴格只 add 兩個 script 檔,其餘留俾 controller 處理。

## Final-review fixes

改咗咩(final code review 嘅 1 Important + 2 Minor):

1. **Quota 防護(Important)** — `scripts/build-team-logos.mjs`:
   - `buildTeamLogos` options 加 `maxCalls`(number | undefined);loop 用 index-based 寫法,每圈開始 check `callsUsed >= maxCalls` 就停,`summary.remaining = pending.slice(index)` 記低未處理嘅隊名。
   - CLI 加 `--max-calls N` parsing(`parseMaxCalls`:搵 `--max-calls` 後面嗰個數,`parseInt`,無效/冇 flag 當 `undefined`)。
   - 開波前 log `[team-logos] pending=N maxCalls=M`(冇設就 `maxCalls=unlimited`);停喺 maxCalls 時 log `[team-logos] stopped at maxCalls; remaining=N — 聽日再跑會繼續`。
2. **Spec 文字對齊(Minor)** — `docs/superpowers/specs/2026-07-20-team-logos-design.md`:
   - Matching 規則最後一句改做:「Script 淨係喺災難性失敗(例如冇 API key)先 exit 1;部分失敗會記低落 summary 繼續。」
   - Deploy 段加 quota 提示(約 320 隊、免費 tier 每日 ~90 calls 同 collector 共用、建議 `--max-calls` 分幾日跑、script idempotent)。
3. **npm script alias(Minor)** — `package.json` scripts 加 `"logos:build": "node scripts/build-team-logos.mjs"`(擺 `import:hkjc` 後面)。

測試指令同結果:

- `node --test scripts/build-team-logos.test.mjs`(改測試後、改實作前):FAIL — 新測試 `buildTeamLogos stops at maxCalls and reports remaining teams` 斷言 `3 !== 1`,符合 TDD 預期。
- `node --test scripts/build-team-logos.test.mjs`(實作後):PASS — `tests 7 / pass 7 / fail 0`,duration ~100ms。新測試斷言:淨係 1 個 search call、`written=1`、`remaining=["Chelsea","Liverpool"]`、`team-logos.json` 只有 Arsenal 冇 Chelsea/Liverpool。
- 冇跑過 `node scripts/build-team-logos.mjs` 本尊(避免使真 quota);前端檔案、其他 script、其他 spec 冇郁過。
