# System Recovery Design

**Date:** 2026-08-09
**Scope:** Personal-use football recommendation system
**Status:** Approved design

## Context

The public site, API, database, tunnel, and collector containers are running, but the recommendation pipeline has silently degraded. Production has `quotaRemaining=49` while the HDC collector requires more than 50 credits, so paid The Odds API collection stopped on 2026-08-02. HKJC ingestion continues, but point-market models need at least two complete bookmaker inputs; therefore the unified sampler has no future HDC inputs and produces no current opportunities.

The review also reproduced three independent reliability problems:

1. Playwright rejects the application's legitimate `GET /api/v1/results` request because the shared UI mock was not updated with the application.
2. The database integrity check treats a legitimate `personal-bet-v1` backfill as a late prediction and loses PostgreSQL timestamp milliseconds before comparing observation inputs.
3. Production's API-Football secret differs from the valid local key. The provider returns an HTTP 200 payload containing `Missing application key`, while the importer discards that message and logs only `API-Football 200`.

This is a single-owner personal system. The design favors practical reliability, visible degraded states, and controlled use of remaining provider credits. It does not add commercial multi-tenant controls or enterprise monitoring.

## Goals

- Resume HDC collection while retaining a small configurable credit reserve.
- Prevent the system from appearing healthy when its recommendation inputs are blocked or stale.
- Restore a trustworthy Playwright feedback loop.
- Make the data-integrity command green for valid production data while retaining its ability to catch real post-kick unified predictions and real future inputs.
- Restore API-Football authentication and make future provider failures diagnosable.
- Deploy the fixes without including unrelated local working-tree changes.

## Non-goals

- Changing model weights, the 3% value threshold, freshness windows, or settlement rules.
- Making HKJC-only point-market recommendations when fewer than two complete bookmakers are available.
- Adding multi-user administration, commercial security controls, or a general monitoring platform.
- Automatically purchasing or renewing provider plans.

## Design

### 1. Controlled HDC recovery

`scripts/hdc-collector.mjs` will read `HDC_MIN_QUOTA` as a non-negative integer. The code default remains 50 so an unspecified deployment preserves the existing policy. Production explicitly sets `HDC_MIN_QUOTA=5` in `deploy/compose.yaml`.

The existing state-driven collection policy remains unchanged: discovery stays on its current cadence, odds are requested only inside the existing 25-minute and 5-minute pre-kick windows, and provider cooldowns remain active. The collector will not spend the final five credits.

Each saved HDC collector state will include:

- `quotaMinimum`: the active reserve;
- `paidCollectionBlocked`: whether quota/cooldown currently prevents paid calls;
- `paidCollectionBlockedReason`: `quota-reserve`, `provider-cooldown`, or `null`.

This state is descriptive and does not alter recommendation logic.

### 2. Visible system status

Add an authenticated, read-only `GET /api/v1/system/status` endpoint. A focused repository query will return:

- latest HKJC live-odds observation;
- latest The Odds API live-odds observation;
- HDC quota remaining, configured reserve, and blocked reason from `collector_state`;
- API-Football last success/error code from HKJC importer state;
- latest unified recommendation observation;
- counts of future HDC odds and future unified snapshots.

The frontend will load this status after authentication and refresh it with the existing current-recommendation polling cycle. When HDC is blocked, stale, or has zero future rows, the Today page will show a concise degraded-data banner with the reason and last update time. It will not fabricate recommendations or hide valid recorded opportunities.

The endpoint is authenticated because it exposes operational details. No new role or security layer is required for this single-owner system.

### 3. Playwright API contract

`tests/ui/helpers.ts` will mock `GET /api/v1/results` with a deterministic result catalog matching the API response shape. Existing tests will continue to fail on any other unmocked application request. A focused E2E case will assert that an authenticated startup requests results and reaches the Today page without an unmocked-request error.

### 4. Integrity-check semantics

Database rows returned as JavaScript `Date` objects will be normalized to ISO strings before entering the pure analyzer. This preserves milliseconds and makes database mode use the same input contract as file mode.

The late-prediction invariant will apply to recommendation strategies, including `unified-buyable-v1`, but not to `personal-bet-v1`. Personal bets are observations of real user activity and may be entered after kickoff. A late unified recommendation must still fail the command.

Regression tests will cover:

- a post-kick personal bet that passes;
- a post-kick unified recommendation that fails;
- an input timestamp within the same second but before the real millisecond evaluation time that passes;
- an input genuinely after evaluation that fails.

### 5. API-Football recovery and diagnostics

The valid local `API_FOOTBALL_KEY` will replace `/opt/odds-tool/secrets/api_football_key` without printing either value. The collector will then be recreated so the entrypoint reads the new secret.

Provider payload errors will be classified into stable codes:

- `API_FOOTBALL_AUTH` for missing/invalid application keys;
- `API_FOOTBALL_QUOTA` for request-limit errors;
- `API_FOOTBALL_PROVIDER` for other HTTP or payload errors.

The importer state will record `apiFootballLastSuccessAt`, `apiFootballLastErrorAt`, and `apiFootballLastErrorCode`. Logs and the system-status endpoint will use the stable code rather than the misleading HTTP status alone. Provider text and secrets will not be persisted.

HKJC CHL data remains the primary corner-odds input. An API-Football failure remains isolated: it may remove the supplemental bookmaker/result fallback, but it must not prevent HKJC import or unified sampling.

### 6. Deployment and rollback

Only the committed recovery files will be transferred to `/opt/odds-tool/build`; unrelated local files and the modified team-logo manifest will not be included.

Before deployment, the current `odds-tool-api:latest` and `odds-tool-caddy:latest` images will be tagged as rollback images. Deployment order:

1. validate Compose configuration;
2. update the API-Football secret through stdin with restrictive permissions;
3. build API and Caddy images;
4. recreate API, Caddy, and collector;
5. run public and internal smoke checks;
6. wait for collector cycles and verify HDC/API-Football state and database freshness.

If API or UI health checks fail, restore the rollback image tags and recreate the affected services. Database migrations are not required.

## Verification

Completion requires all of the following evidence:

- the HDC quota feedback loop changes from blocked at 49/50 to allowed at 49/5;
- production records fresh The Odds API observations after deployment when a tracked event enters the collection window, or the collector state proves it is allowed and no event is due;
- API-Football `/status` accepts the production-mounted key and importer state no longer reports `API_FOOTBALL_AUTH`;
- `npm.cmd test` passes;
- `npm.cmd run build` passes;
- all five self-tests pass;
- the focused Playwright regression passes, followed by the complete 76-case UI suite;
- `node scripts/check-data-integrity.mjs --database` passes in production;
- public smoke remains `200 / 200 / 401 / 404` for home, session, protected results, and internal readiness;
- API, Caddy, and PostgreSQL containers are healthy and collector/tunnel remain running;
- no diagnostic artifacts or unrelated user changes are committed.

## Success Criteria

The system is fixed when its provider state is truthful and visible, paid HDC collection is no longer blocked by the obsolete 50-credit floor, the valid API-Football key is active, all automated feedback loops are green, and production verification shows either fresh recommendation inputs or an accurate non-failure reason why no provider call is currently due.
