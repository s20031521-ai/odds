# HDC、大小球、角球集中收集設計

**日期：** 2026-07-11

## 目標

集中亞洲讓球、大小球、角球。延用現有 quota-aware collector，不新增 service 或 dependency。

## 最小改動

1. 將現有 HDC leave-one-out 核心抽成共用「兩路同盤市場」函數。
2. HDC 仍以主／客及 signed line 使用同一函數，行為不變。
3. 大小球以 Over／Under 及 exact line 使用同一函數：
   - 候選 bookmaker 不參與自己的去水共識。
   - 至少兩個 bookmaker。
   - edge >= 3% 才買。
   - 保存 bookmaker、大小方向、line、odds、chance、edge、`totals-loo-v1`。
4. Background collector 在開賽前 30 分鐘一次請求 `markets=spreads,totals`。同一 region 兩個市場每次最多 2 credits；仍由 30 分鐘窗口及 quota floor 控制。
5. 完場比分已足夠同時結算 HDC 及大小球，不加另一條 scores flow。
6. Dashboard 從 collector cache 同時讀 HDC 及 totals cards。

## 角球

- 現時只有 HKJC CHL 單一賠率來源，無法建立獨立市場共識。
- Collector 每 15 分鐘沿用現有 `hkjc-import.mjs` 更新角球盤及完場角球。
- 角球維持 `資料不足，唔買`，不製造 snapshot 或假 edge。
- 有第二個可靠角球來源或球隊角球統計後，再接入同一兩路市場函數。

## 驗收

- 共用 domain 測試 HDC 行為不變、Totals leave-one-out、候選自我排除、少於兩個來源拒買。
- Collector self-test 驗證一次 request 只用 `spreads,totals`，snapshot model/version 正確。
- Synthetic totals payload 能保存 immutable background snapshot。
- Scores 能同時結算 HDC 及大小球。
- Dashboard smoke、全套 tests/build/self-tests、cron run 均通過。

## Skipped

- 外圍角球市場整合。
- 球隊統計模型、自動調參、主客和。
