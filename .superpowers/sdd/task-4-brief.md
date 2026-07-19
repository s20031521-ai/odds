### Task 4: Fail-closed fixture matching

**Files:**
- Create: `src/fixtureMatch.test.ts`
- Modify: `src/fixtureMatch.ts`

**Interfaces:**
- Keeps: `sameFixture(left, right): boolean` and `groupByFixture(entries): Map<string, entries[]>`.
- Canonical team identity includes normalized name plus gender marker.

- [ ] **Step 1: Write failing matching regressions**

Test:

```ts
expect(sameFixture(fixture("Manchester", "Liverpool"), fixture("Manchester United", "Liverpool"))).toBe(false);
expect(sameFixture(fixture("Arsenal Women", "Chelsea Women"), fixture("Arsenal", "Chelsea"))).toBe(false);
expect(sameFixture(fixture("Djurgardens", "Halmstads"), fixture("Djurgårdens IF", "Halmstads BK", 5))).toBe(true);
expect(sameFixture(fixture("A", "B"), fixture("A", "B", 11))).toBe(false);
```

Use unique match IDs and kickoff offsets in minutes.

- [ ] **Step 2: Run `npm.cmd test -- --run src/fixtureMatch.test.ts` and verify RED**

Expected: Manchester substring and women/men cases incorrectly return true.

- [ ] **Step 3: Replace substring matching with canonical exact matching**

Normalize accents, case, punctuation, and the club suffix tokens `fc`, `afc`, `cf`, `bk`, `if`, `sk`. Detect `women`, `w`, `ladies`, and `女足` before suffix removal. Compare exact normalized base plus equal gender marker; never use `includes()`.

- [ ] **Step 4: Verify matching and existing odds tests GREEN**

Run:

```powershell
npm.cmd test -- --run src/fixtureMatch.test.ts src/odds.test.ts src/handicap.test.ts
```

Expected: all tests pass; HKJC accent/suffix merge remains intact.

---

