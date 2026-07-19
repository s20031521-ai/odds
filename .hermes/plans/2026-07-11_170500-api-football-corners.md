# API-Football Corner Odds Plan

- [x] Parse `Corners Over Under` rows into existing `TotalsMarketEntry` shape.
- [x] Query only HKJC CHL fixtures inside 30 minutes, reuse existing fixture matcher.
- [x] Merge API-Football bookmakers with HKJC and reuse `buildTotalsCards` leave-one-out engine.
- [x] Verify self-test, live importer, build, and browser.

Ponytail: no new service, dependency, cache schema, or model.
