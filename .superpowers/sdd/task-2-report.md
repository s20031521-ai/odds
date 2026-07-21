# Task 2 Report: `buildMatchMarketDetails` 純函數

## 做咗咩

- 新開 `src/matchDetails.ts`（LF）：按 brief Step 3 逐字實裝 `buildMatchMarketDetails`，export `TotalsCard`、`MarketDetail`、`MatchMarketDetails`、`MatchHeaderInfo`、`buildMatchMarketDetails`。冇加 brief 冇要求嘅 export。
- 新開 `src/matchDetails.test.ts`（LF）：按 brief Step 1 嘅 9 個測試實裝（有兩處最小類型修正，見「Self-review 發現」）。
- 冇掂任何現有檔案；commit 淨係呢兩個新檔（`git show --stat HEAD`：2 files changed, 222 insertions, 兩個都係 create）。

## Test 結果（逐字摘要）

Step 2 紅燈確認：

```
FAIL  src/matchDetails.test.ts [ src/matchDetails.test.ts ]
Error: Cannot find module './matchDetails' imported from C:/Users/itadmin/Documents/賭/src/matchDetails.test.ts
 Test Files  1 failed (1)
      Tests  no tests
```

Step 4 綠燈確認（實裝後單檔）：

```
 ✓ src/matchDetails.test.ts (9 tests) 4ms
 Test Files  1 passed (1)
      Tests  9 passed (9)
```

全套測試（regression check）：

```
 Test Files  36 passed (36)
      Tests  238 passed (238)
```

## tsc 結果

```
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
tsc exit: 0
```

（首次跑有 2 個 error，修正測試後 clean，詳見下面。）

## Commit

- Hash: `5131654c25a44e83e0b8f3d2b97bf8df2a4eab4c`
- Message: `feat: buildMatchMarketDetails for single-match analysis`
- Branch: `today-first-phase-b`

## Self-review（對返 brief 每個 step）

- [x] Step 1 寫失敗測試：完成，9 個 `it` 同 brief 一致（兩處類型修正除外）。
- [x] Step 2 跑測試確認 fail：`Cannot find module './matchDetails'`，符合預期。
- [x] Step 3 實裝：逐字用 brief 嘅 code，包括 `TotalsCard = ReturnType<typeof buildTotalsCards>[number]`、`resolveHeader` structural return、`formatLine` 整數轉 `.toFixed(1)`。
- [x] Step 4 跑測試確認 pass：9/9 pass。`stake` 斷言 **唔使改**：`displayStake({ market:"大細波", selection:"大 2.5", line:2.5, odds:1.95, chance:0.58, edge:0.131, bookmaker:"Book B" })` 實際回 20，同 brief 註解（kelly(0.58,1.95) → cap 2% of 1000 = 20）一致，斷言原樣通過。
- [x] Step 5 Commit：完成，只 add 兩個新檔。
- [x] 紅線：`git status` / commit stat 確認冇現有檔案被改動；模型檔只 import 唔改。
- [x] YAGNI：冇額外 export 或功能。

## Self-review 發現（同 brief 嘅偏差）

**brief 逐字測試過唔到 tsc。** brief Step 1 嘅 `card()` factory 回傳 `HandicapCard`，再直接畀 `totalCards` 用；但 `TotalsCard`（`ReturnType<typeof buildTotalsCards>[number]`，見 `src/oddsApi.ts:143-148`）比 `HandicapCard` 多咗必填 `id: string`，而且 `bestSide` 係 `"大" | "細" | null`，同 `HandicapCard["bestSide"]`（`"主" | "客"`，`src/handicap.ts:4`）係 disjoint。tsc 報：

```
src/matchDetails.test.ts(69,88): error TS2741: Property 'id' is missing in type 'HandicapCard' but required in type '{ id: string; bestSide: "大" | "細" | null; ... }'.
src/matchDetails.test.ts(82,75): error TS2322: Type 'HandicapCard[]' is not assignable to type '{ id: string; bestSide: "大" | "細" | null; ... }[]'.
```

**修正（只改新測試檔，冇掂模型檔）**：兩個 `totalCards` 構造位改為 spread 加欄位——

- `totalCards: [{ ...card(), id: "t1", bestSide: "大" as const }]`
- `const cards = [{ ...card({ line: 2.0, bestEdge: 0.02 }), id: "t1", bestSide: "大" as const }, { ...card({ line: 3.0, bestEdge: 0.2 }), id: "t2", bestSide: "大" as const }];`

`bestSide: "大" as const` 收窄到 `"大"`，可同時 assign 入 TotalsCard；runtime 值同 brief 原本一樣（`"大"`、`id` 只係補型別必填欄位），所有斷言逐字不變，9 個測試行為冇變。`handicapCards` 用法（brief 原本就 typecheck）保持逐字。修正後 tsc exit 0、vitest 9/9 pass。

## Concerns

1. **後續 task 注意 `TotalsCard` ≠ `HandicapCard`**：Task 3/4/6 consume `TotalsCard` 時要記得佢有必填 `id`，`bestSide` 係 `"大"|"細"|null`（唔係 `"主"|"客"`），`pickLabel` 係 `"買大"/"買細"` 格式。brief 嘅 Interfaces 段落冇講呢個差異。
2. Git 提示 `LF will be replaced by CRLF the next time Git touches it` — repo 入面兩個檔係 LF 儲存（commit 時 normalized），本地 working copy 都仲係 LF；呢個只係 autocrlf checkout 警告，唔影響行尾要求。
3. 工作目錄有唔少 pre-existing 嘅 untracked/modified 檔（`data/*`、`scripts/tmp-*`、`.superpowers/sdd/*` 等），唔係我呢個 task 嘅嘢，冇掂。
