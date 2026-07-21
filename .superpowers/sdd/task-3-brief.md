### Task 3: `displayStake` 注碼顯示 helper

**Files:**
- Create: `src/stakeDisplay.ts`
- Test: `src/stakeDisplay.test.ts`

**Interfaces:**
- Consumes: `BuyPick`（`src/buyOpportunities.ts:5-13`）。
- Produces:
  ```ts
  export type StakeSettings = { bankroll: number; fractionalKelly: number; stakeCapPercent: number };
  export const DEFAULT_STAKE_SETTINGS: StakeSettings; // { bankroll: 1000, fractionalKelly: 0.25, stakeCapPercent: 0.02 }
  export function displayStake(pick: BuyPick, settings?: StakeSettings): number; // 回傳整數金額
  ```
  Task 4 `PickCard` 用 `displayStake(primary)`。呢個係**顯示層** helper，公式跟現行 analyzer defaults，唔郁任何模型檔。

- [ ] **Step 1: 寫 test（RED）**

Create `src/stakeDisplay.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import type { BuyPick } from "./buyOpportunities";
import { DEFAULT_STAKE_SETTINGS, displayStake } from "./stakeDisplay";

const pick = (chance: number, odds: number): BuyPick => ({
  market: "大細波", selection: "大", line: 2.5, odds, chance, edge: chance * odds - 1, bookmaker: "Alpha",
});

describe("displayStake", () => {
  it("caps at 2% of bankroll when fractional Kelly exceeds the cap", () => {
    // fullKelly = (0.58*1.95-1)/(1.95-1) ≈ 0.138 → ×0.25 ≈ 0.0345 > 0.02 cap → 1000×0.02 = 20
    expect(displayStake(pick(0.58, 1.95))).toBe(20);
  });

  it("returns fractional Kelly stake when below the cap", () => {
    // fullKelly = (0.52*1.5-1)/0.5 = -0.44 → 負數 clamp 做 0；用正例：(0.55*1.4-1)/0.4 = -0.575 都係負
    // 正例：odds 3.0 chance 0.36 → fullKelly = (1.08-1)/2 = 0.04 → ×0.25 = 0.01 → 1000×0.01 = 10
    expect(displayStake(pick(0.36, 3.0))).toBe(10);
  });

  it("returns 0 for negative edge", () => {
    expect(displayStake(pick(0.3, 2.0))).toBe(0);
  });

  it("returns 0 for invalid inputs", () => {
    expect(displayStake(pick(0, 1.95))).toBe(0);
    expect(displayStake(pick(0.5, 1))).toBe(0);
  });

  it("respects custom settings", () => {
    expect(displayStake(pick(0.36, 3.0), { bankroll: 5000, fractionalKelly: 0.25, stakeCapPercent: 0.02 })).toBe(50);
  });

  it("exposes frozen defaults matching analyzer settings", () => {
    expect(DEFAULT_STAKE_SETTINGS).toEqual({ bankroll: 1000, fractionalKelly: 0.25, stakeCapPercent: 0.02 });
  });
});
```

- [ ] **Step 2: 跑 test 確認 fail**

Run: `node node_modules/vitest/vitest.mjs run src/stakeDisplay.test.ts`
Expected: FAIL — module 未存在

- [ ] **Step 3: 寫 implementation（GREEN）**

Create `src/stakeDisplay.ts`：

```ts
import type { BuyPick } from "./buyOpportunities";

export type StakeSettings = {
  bankroll: number;
  fractionalKelly: number;
  stakeCapPercent: number;
};

// Display-only mirror of the analyzer defaults in src/App.tsx — never edit
// these values without owner approval (model freeze red line).
export const DEFAULT_STAKE_SETTINGS: StakeSettings = {
  bankroll: 1000,
  fractionalKelly: 0.25,
  stakeCapPercent: 0.02,
};

export function displayStake(pick: BuyPick, settings: StakeSettings = DEFAULT_STAKE_SETTINGS): number {
  if (!(pick.odds > 1) || !(pick.chance > 0) || !(pick.chance <= 1)) return 0;
  const fullKelly = (pick.chance * pick.odds - 1) / (pick.odds - 1);
  const fraction = Math.min(Math.max(fullKelly, 0) * settings.fractionalKelly, settings.stakeCapPercent);
  return Math.round(settings.bankroll * fraction);
}
```

- [ ] **Step 4: 跑 test 確認 pass**

Run: `node node_modules/vitest/vitest.mjs run src/stakeDisplay.test.ts`
Expected: PASS（6 tests）

- [ ] **Step 5: Commit**

```bash
git add src/stakeDisplay.ts src/stakeDisplay.test.ts
git commit -m "feat: add displayStake helper for pick cards"
```

---

