### Task 4: 接入 `App.tsx` + 全套驗證

**Files:**
- Modify: `src/App.tsx`(import 一行 + dashboard 渲染一行;注意檔案係 CRLF 混合換行,Edit 要用實際換行)

**Interfaces:**
- Consumes: `DashboardPage(props)` from `src/pages/DashboardPage.tsx`(Task 3)
- Produces: 無新介面;`#/dashboard` 行為改變。

- [ ] **Step 1: 改 import** — `src/App.tsx` 第 25 行:

```ts
import { BuyDashboard } from "./pages/BuyDashboard";
```

改做:

```ts
import { DashboardPage } from "./pages/DashboardPage";
```

(先 grep 確認 `BuyDashboard` 喺 App.tsx 淨係出現喺呢兩處先好改。)

- [ ] **Step 2: 改 dashboard 渲染** — 第 443 行:

```tsx
<BuyDashboard opportunities={buyOpportunities} generatedAt={lastSuccessfulSync} dataFresh={opportunitiesTrusted} />
```

改做:

```tsx
<DashboardPage opportunities={buyOpportunities} generatedAt={lastSuccessfulSync} dataFresh={opportunitiesTrusted} />
```

- [ ] **Step 3: 行全套測試**

Run: `npm test`
Expected: 全綠,包括原有 `BuyDashboard.test.tsx`、`App.test.tsx` 冇改過都照過

如果 `App.test.tsx` 有斷言講 dashboard 直出 `BuyDashboard` 內容(例如「值得買 Dashboard」標題),而而家預設係極簡,可能要檢視 — 但 Global Constraint 係唔准改 `BuyDashboard.test.tsx`;`App.test.tsx` 如有需要可以改,將極簡預設嘅預期寫埋入去。改之前先睇清楚個 test 斷言咩。

- [ ] **Step 4: 行 build**

Run: `npm run build`
Expected: `tsc --noEmit` 無 error,vite build 成功

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx
git commit -m "feat: route dashboard through simple/pro mode page"
```
