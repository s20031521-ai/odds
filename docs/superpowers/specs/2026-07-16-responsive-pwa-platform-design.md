# Odds Tool Responsive PWA and Production Platform Design

## Goal

Turn the current local React/Vite odds tool into a relaxed, cross-device decision dashboard and, in a later delivery phase, a secure single-owner production PWA hosted on an Ubuntu VM.

## Product design

- The default route is **值得買**, a dashboard that contains only current, fresh, pre-match opportunities whose edge is at least the existing fixed `0.03` threshold.
- A match occupies one card. Its highest-edge market is primary; other qualifying markets appear as secondary chips.
- Opportunities sort by edge descending, kickoff ascending, then `matchId` ascending.
- **全部賽事** contains the complete upcoming feed, including no-pick and missing-data fixtures. **完場紀錄** and **模型健康** retain the existing backtest and readiness views.
- Empty or stale data never causes the threshold to be reduced. Stale data removes active buy styling and produces an explicit warning.

## Visual and responsive design

The selected direction is **柔和夜間**: background `#11182B`, surface `#182038`, primary `#7C83C8`, positive `#9CE2CF`, warning `#F2C879`, main text `#F6F7FF`, muted text `#8E9CBA`, 16px card radii, soft borders, restrained motion and no trading-terminal visual noise.

- Desktop: top navigation, opportunity list plus a compact summary rail.
- iPad landscape: two columns; portrait: one column.
- iPhone: single-column cards, bottom navigation, sticky market filters, safe-area padding and 44px minimum touch targets.
- Dashboard KPIs are qualifying matches, qualifying picks, average edge and next kickoff. No synthetic confidence score is introduced.

## PWA behavior

- The same responsive web application supports desktop browsers, iPhone and iPad, including Safari Add to Home Screen standalone mode.
- The service worker caches only the versioned application shell and static assets. Live odds, health and dashboard API responses remain network-first/no-store.
- Offline mode may open the shell and show the last sync timestamp, but cannot show cached rows as active buy opportunities.
- App Store, Capacitor, native push notifications and native mobile packages are out of scope.

## Future production platform

- Ubuntu LTS with Docker Compose services for Caddy, Node API/web, collector worker, PostgreSQL and encrypted S3 backup.
- A single pre-provisioned owner account, no public signup, Argon2id password hashing, opaque server sessions, rate limiting and same-origin HTTPS APIs.
- PostgreSQL becomes source of truth. Existing JSON/JSONL archives are imported idempotently and retained read-only with legacy/invalid classifications intact.
- All collectors run on the VM. The public edge exposes only ports 80/443; database and importer interfaces remain internal.
- Private GitHub provides CI, image builds and deployment approval. Production infrastructure is delivered under a separate implementation plan after the UI/PWA gate passes.

## Non-goals and invariants

- Do not change the model, settlement logic, Kelly rules, ROI rules or the 3% threshold.
- Do not consume paid provider quota in automated tests.
- Existing 106 tests and archive hashes remain the baseline.
- Production v1 has no MFA, multi-user roles, push notifications, native apps or offline betting recommendations.
