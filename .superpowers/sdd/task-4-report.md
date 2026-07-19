# Task 4 Report: 接入 `App.tsx` + 全套驗證

**Status:** DONE
**Commit:** `4e4cf0d5a21663d623680f266e219f9037915fac`(`feat: route dashboard through simple/pro mode page`)
**Branch:** `feature/simple-dashboard-mode`

## 做咗咩

1. **Grep 確認** `BuyDashboard` 喺 `src/App.tsx` 只出現兩處:第 25 行 import、第 443 行渲染。
2. **Step 1 — 改 import**(第 25 行):
   `import { BuyDashboard } from "./pages/BuyDashboard";` → `import { DashboardPage } from "./pages/DashboardPage";`
3. **Step 2 — 改渲染**(第 443 行):
   `<BuyDashboard opportunities={buyOpportunities} generatedAt={lastSuccessfulSync} dataFresh={opportunitiesTrusted} />` → `<DashboardPage ... />`(props 完全一致,無改動)。
   兩處都用 Edit 工具精準修改,冇重寫檔案;目標行本身係 LF,無 CRLF 問題。
4. **Step 3 — 全套測試**:`node node_modules/vitest/vitest.mjs run` → **28 files / 183 tests 全部通過**(包括原有 `BuyDashboard.test.tsx` 9 tests、改咗嘅 `App.test.tsx` 12 tests、`DashboardPage.test.tsx` 4 tests)。
5. **Step 4 — Build**:`tsc --noEmit` 零 error;`vite build` 成功(index bundle 254.36 kB,PWA SW 生成正常)。
6. **Step 5 — Commit**:`git add src/App.tsx src/App.test.tsx && git commit`。

## App.test.tsx 改動同理由

`App.test.tsx` **需要改**,改咗兩行 assertion(第一個 test「wires the shell and both new pages...」入面):

- `expect(source).toContain('import { BuyDashboard } from "./pages/BuyDashboard"')` → `import { DashboardPage } from "./pages/DashboardPage"`
- `expect(source).toContain("<BuyDashboard")` → `"<DashboardPage"`

**理由:** 呢個 test 係 source-string wiring assertion,唔係行為斷言 — 佢唔係斷言「值得買 Dashboard」標題或專業模式內容,而係確認 App.tsx 有正確 import 同渲染對應頁面組件。Task 4 嘅目的本身就係將 wiring 由 BuyDashboard 換成 DashboardPage,所以將 assertion 更新為新嘅 wiring 係**邏輯上等價嘅收緊**(仍然強制 dashboard route 必須經指定頁面組件),唔係放水。其餘 10 個 tests 完全無改動,全部照過。

`BuyDashboard.tsx` 同 `BuyDashboard.test.tsx` 完全無掂過。

## 指令同結果

| 指令 | 結果 |
|---|---|
| `node node_modules/vitest/vitest.mjs run` | 28 files, 183 tests passed |
| `node node_modules/vitest/vitest.mjs run src/App.test.tsx` | 12 tests passed |
| `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` | 零 error |
| `node node_modules/vite/bin/vite.js build` | 成功,dist 生成 + PWA SW |

## Self-review

- Grep 複查:`src/App.tsx` 而家只有 `DashboardPage` 兩處(import + 渲染),`BuyDashboard` 零殘留。
- Commit diff 只有 4 insertions / 4 deletions,恰好係 brief 要求嘅兩行 App.tsx + 兩行 App.test.tsx。
- 無觸碰 `BuyDashboard.tsx` / `BuyDashboard.test.tsx`;git status 確認 commit 只含兩個檔案。
- Commit 時 git 提示 LF→CRLF 警告,係 repo 既有 autocrlf 行為,唔影響內容。

## Concerns

無。
