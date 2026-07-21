### Task 5 Report: PickCard「睇單場分析」改指新頁

**Status:** DONE

**Commit:** `9808b08328777b0f6af0f26d4966cea30df5015f` — `feat: point pick card analysis link at match analysis page`

**Changes (3 lines, 2 files, as briefed):**
- `src/components/PickCard.test.tsx:52` — locked 字串改為 `href="#/analysis?match=match-1"`
- `src/components/PickCard.test.tsx:71` — locked 字串改為 `href="#/analysis?match=match%201"`
- `src/components/PickCard.tsx:43` — href 改為 `#/analysis?match=${encodeURIComponent(opportunity.matchId)}`

**TDD sequence:**
1. RED — 改測試後跑 `node node_modules/vitest/vitest.mjs run src/components/PickCard.test.tsx`：2 failed / 5 passed（兩條 href 斷言如預期 fail）。
2. 改 source 一行 href。
3. GREEN — 重跑：`Test Files 1 passed (1)`, `Tests 7 passed (7)`。
4. Commit 兩個檔案（3 insertions / 3 deletions），無其他檔案被改動。

**Concerns:** 無。
