# Task 4 — Installable responsive PWA and fail-closed offline state

## Scope

Turn the existing responsive React/Vite interface into an installable PWA without changing odds/model/backend/archive behavior.

## Binding requirements

1. Use `vite-plugin-pwa` with an auto-updating service worker.
2. Manifest:
   - `name`: `Odds Value Dashboard`
   - `short_name`: `Odds Dashboard`
   - `start_url`: `/#/dashboard`
   - `scope`: `/`
   - `display`: `standalone`
   - `theme_color`: `#11182B`
   - `background_color`: `#11182B`
   - include 192x192, 512x512, maskable 512x512 and 180x180 Apple touch PNG assets.
3. Add the matching `theme-color`, viewport and Apple touch metadata to `index.html`.
4. Service worker caching must be app-shell/static-assets only:
   - precache HTML/JS/CSS/fonts/icons/manifest only;
   - do not precache `public/hkjc-odds.json` or any odds/archive/data JSON;
   - do not add runtime caching for `/api`, odds JSON, archives, health, fixtures or results;
   - navigation fallback must exclude `/api/`.
5. Add a small typed online-status helper/hook with cleanup-safe `online`/`offline` listeners.
   - Initial status must come from `navigator.onLine`; unknown/unavailable is fail-closed.
   - Offline must immediately hide all active opportunities by feeding false into the existing freshness gate.
   - Show a clear Cantonese alert: `目前離線；已隱藏值得買機會，連線後會自動恢復。`
   - Reconnection may restore opportunities only when the separate health freshness state is still true; do not bypass health validation.
6. Keep the exact 3% threshold and all existing model/API/data contracts unchanged.
7. No push notifications, background sync, native wrapper, login, deployment or production-server work in this task.
8. Do not call paid providers. Do not modify JSON/JSONL archives.

## TDD and verification

Follow strict RED/GREEN:

- tests for online-status initialization, online/offline transitions and listener cleanup;
- test the fail-closed composition: opportunity data is trusted only when both health freshness and online status are true;
- config/contract tests for manifest, icon metadata, API navigation denylist, JSON exclusion and absence of runtime API caching;
- App wiring test proving the combined gate and offline warning are actually used.

Then run:

- focused Task 4 tests;
- complete Vitest suite;
- `npm run build`;
- inspect `dist/manifest.webmanifest`, generated service-worker files and precache entries, explicitly proving `hkjc-odds.json`, `/api`, archives and result data are absent;
- record archive hashes before/after.

## Delivery

Append exact RED/GREEN/full/build/SW inspection/hash evidence and changed files to `.superpowers/sdd-responsive-pwa/task-4-report.md`. Do not create a Git commit (this workspace has no usable Git metadata).
