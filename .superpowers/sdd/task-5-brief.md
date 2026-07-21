### Task 5: PickCard「睇單場分析」改指新頁

**Files:**
- Modify: `src/components/PickCard.tsx:43`
- Test: `src/components/PickCard.test.tsx:52,71`（同步改 locked 字串）

**Interfaces:**
- Consumes: Task 1 嘅 route convention（`#/analysis?match=<encoded>`）。

- [ ] **Step 1: 先改測試（RED）**

`src/components/PickCard.test.tsx:52` 改做：

```ts
    expect(markup).toContain('href="#/analysis?match=match-1"');
```

`:71` 改做：

```ts
    expect(markup).toContain('href="#/analysis?match=match%201"');
```

- [ ] **Step 2: 跑測試確認 fail**

Run: `node node_modules/vitest/vitest.mjs run src/components/PickCard.test.tsx`
Expected: FAIL（兩條 href 斷言）

- [ ] **Step 3: 改 `src/components/PickCard.tsx:43`**

```tsx
        <a className="pick-card__analysis-link" href={`#/analysis?match=${encodeURIComponent(opportunity.matchId)}`}>
```

- [ ] **Step 4: 跑測試確認 pass**

Run: `node node_modules/vitest/vitest.mjs run src/components/PickCard.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/PickCard.tsx src/components/PickCard.test.tsx
git commit -m "feat: point pick card analysis link at match analysis page"
```

---

