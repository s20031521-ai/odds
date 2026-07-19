# The Odds API quota efficiency plan

**Goal:** Remove browser quota duplication and reduce background paid polling while preserving two pre-kick chances and delayed score settlement.

**Hypothesis:** Frontend auto-fetch is the main current leak; two pre-kick polls and two score attempts/day retain useful coverage at a fraction of the credits.

**Success:** No automatic frontend `/odds` request; odds polls only near -25m and -5m; scores start at +180m and retry after 12h; reserve 50 credits; 429 blocks paid calls for 15m.

**Failure signals:** hourly browser run calls The Odds API; more than two odds calls per event window; hourly score retries; paid calls continue during cooldown; self-tests/build fail.

**Evidence:** RED/GREEN collector self-test, full tests/build, browser network/console smoke, collector dry-run.

- [x] Remove frontend auto-fetch and orphan throttle helper/test.
- [x] Add RED collector assertions for two windows, 12h score retry, reserve, and cooldown.
- [x] Implement minimal collector gating.
- [x] Verify and update prediction log.
