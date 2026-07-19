# Task 4 report — Installable responsive PWA and fail-closed offline state

## Result

Implemented the approved installable PWA shell with `vite-plugin-pwa` 1.3.0, auto-updating generated service worker, exact manifest/theme metadata, required PNG icons, cleanup-safe connectivity listeners and a fail-closed online + health freshness gate. Offline state immediately suppresses active opportunities and shows:

`目前離線；已隱藏值得買機會，連線後會自動恢復。`

Reconnection only restores opportunities when the independent health freshness state remains true. No model, API, archive, data contract or 3% threshold behavior was changed.

## Strict RED / GREEN evidence

### RED

1. `npm.cmd test -- src/pwa.test.ts`
   - 1 failed / 1 total.
   - Expected failure: `src/pwa.ts` did not exist.
2. After creating the empty module, connectivity behavior tests were added first and run with the same focused command.
   - 4 failed / 5 total.
   - Expected failure: required typed functions were undefined.
3. `npm.cmd test -- src/pwa.test.ts src/pwaConfig.test.ts src/App.test.tsx`
   - 7 failed / 18 total.
   - Expected failures: missing plugin/config, manifest, icons, HTML metadata and App combined-gate wiring.
4. Generated-service-worker inspection exposed duplicate icon entries. A regression contract was added first:
   - `npm.cmd test -- src/pwaConfig.test.ts`: 1 failed / 5 total because `includeAssets` duplicated globbed assets.
5. iPhone/iPad installation guidance was added test-first:
   - `npm.cmd test -- src/components/AppShell.test.tsx`: 1 failed / 11 total because the guidance was absent.
6. A second generated-service-worker inspection exposed manifest/icon duplication from automatic manifest entries plus globbing. Exact ignore contracts were added first:
   - `npm.cmd test -- src/pwaConfig.test.ts`: 1 failed / 5 total because generated manifest/icon assets were not yet excluded from the glob pass.

All RED failures were for the intended missing behavior or generated precache duplication.

### GREEN

- Connectivity module: `src/pwa.test.ts` — 5/5 passed.
- Initial Task 4 focused set: 18/18 passed.
- PWA config after deduplication: `src/pwaConfig.test.ts` — 5/5 passed.
- App shell install guidance: `src/components/AppShell.test.tsx` — 11/11 passed.
- Final focused Task 4 command:
  - `npm.cmd test -- src/pwa.test.ts src/pwaConfig.test.ts src/App.test.tsx src/components/AppShell.test.tsx`
  - 4 files passed, 29/29 tests passed, exit 0.

## Fresh final verification

- Complete Vitest suite: `npm.cmd test`
  - 24 files passed.
  - 157/157 tests passed.
  - Exit 0.
- Production build: `npm.cmd run build`
  - TypeScript check passed.
  - Vite production build passed.
  - PWA mode `generateSW`.
  - 9 precache entries, 255.42 KiB.
  - Generated `dist/sw.js` and `dist/workbox-9c191d2f.js`.
  - Exit 0.

## Built manifest inspection

`dist/manifest.webmanifest` contains:

- `name`: `Odds Value Dashboard`
- `short_name`: `Odds Dashboard`
- `start_url`: `/#/dashboard`
- `scope`: `/`
- `display`: `standalone`
- `theme_color`: `#11182B`
- `background_color`: `#11182B`
- `lang`: `zh-Hant`
- 192x192 icon, 512x512 icon and maskable 512x512 icon.

`index.html` contains the matching viewport-fit, theme color, Apple standalone/status-bar metadata and the 180x180 Apple touch icon.

## Generated service-worker inspection

The final parsed precache list contains exactly 9 static shell assets:

1. `registerSW.js`
2. `index.html`
3. `icons/apple-touch-icon.png`
4. generated CSS asset
5. generated JS asset
6. `icons/icon-192.png`
7. `icons/icon-512.png`
8. `icons/icon-maskable-512.png`
9. `manifest.webmanifest`

Inspection results:

- Forbidden precache URL count: **0**.
- `hkjc-odds.json`: absent from precache (although Vite still copies the source file to `dist`, it is never cached by the worker).
- `/api`, health, fixture, result, snapshot, archive and other `.json` data: absent from precache.
- API navigation denylist present: `denylist:[/^\/api\//]`.
- Runtime route count: 1, and it is the navigation fallback only.
- No runtime API/odds/health/fixture/result caching was generated.

## Archive integrity

Before and after values are identical:

- `data/prediction-snapshots.jsonl`
  - SHA256: `E55625769E4560B524773BD4A8C2884EFF236540AFC63B2187F3FAE7696617BA`
- `data/background-hdc-snapshots.jsonl`
  - SHA256: `E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855`

No paid provider was called and no JSON/JSONL archive was modified.

## Changed files

- `package.json`
- `package-lock.json`
- `vite.config.ts`
- `index.html`
- `src/pwa.ts`
- `src/pwa.test.ts`
- `src/pwaConfig.test.ts`
- `src/App.tsx`
- `src/App.test.tsx`
- `src/components/AppShell.tsx`
- `src/components/AppShell.test.tsx`
- `src/styles/layout.css`
- `public/icons/icon-192.png`
- `public/icons/icon-512.png`
- `public/icons/icon-maskable-512.png`
- `public/icons/apple-touch-icon.png`
- `.superpowers/sdd-responsive-pwa/generate-pwa-icons.cjs` (deterministic, dependency-free binary asset generator)
- `.superpowers/sdd-responsive-pwa/task-4-report.md`

No Git commit was created because this workspace has no usable Git metadata.
