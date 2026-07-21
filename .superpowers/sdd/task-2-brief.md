### Task 2: AppShell nav labels 改名

**Files:**
- Modify: `src/components/AppShell.tsx:5-10`
- Test: `src/components/AppShell.test.tsx`

**Interfaces:**
- Consumes: Task 1 嘅 `Page` type。
- Produces: nav items `今日 #/today`、`賽程 #/fixtures`、`分析 #/analysis`、`紀錄 #/history`（呢個順序）。Playwright `dashboard.spec.ts` 用 `getByRole("link", { name })` 會受影響（Task 11 處理）。

- [ ] **Step 1: 改 test（RED）**

`src/components/AppShell.test.tsx:7-12` 嘅 expected array 改做：

```ts
["#/today", "今日"],
["#/fixtures", "賽程"],
["#/analysis", "分析"],
["#/history", "紀錄"],
```

- [ ] **Step 2: 跑 test 確認 fail**

Run: `node node_modules/vitest/vitest.mjs run src/components/AppShell.test.tsx`
Expected: FAIL（舊 labels `值得買/全部賽事/完場紀錄/模型健康` 唔 match）

- [ ] **Step 3: 改 `src/components/AppShell.tsx:5-10`（GREEN）**

```ts
const navigationItems = Object.freeze([
  { route: "today", href: "#/today", label: "今日" },
  { route: "fixtures", href: "#/fixtures", label: "賽程" },
  { route: "analysis", href: "#/analysis", label: "分析" },
  { route: "history", href: "#/history", label: "紀錄" },
] as const);
```

- [ ] **Step 4: 跑 test 確認 pass**

Run: `node node_modules/vitest/vitest.mjs run src/components/AppShell.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/AppShell.tsx src/components/AppShell.test.tsx
git commit -m "feat: rename nav labels to 今日/賽程/分析/紀錄"
```

---

