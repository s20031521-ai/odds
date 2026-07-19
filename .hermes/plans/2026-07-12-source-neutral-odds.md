# Source-neutral odds ingestion plan

**Hypothesis:** Dashboard coverage is constrained because discovery is hard-coded to eight leagues and UI refresh treats HKJC as the owner. Dynamic active-soccer discovery plus independent cache merging will expose The Odds API fixtures without requiring HKJC.

**Success:** Active soccer discovery includes current supported leagues such as Brazil, Sweden, Norway, Finland and Korea; The Odds API cards survive without HKJC; HKJC cards survive without The Odds API; exact event+line matches can still merge; quota reserve remains 50; live collector and browser tabs work.

**Independent failure signals:** `/sports` fails or returns malformed data; discovery selects non-soccer/outright sports; a refresh deletes another provider's entries; paid calls continue at or below 50 credits; duplicate cards appear for the same provider/event/line; browser paid requests occur.

**Ablation expectations:** With HKJC absent, cached The Odds API cards remain. With The Odds API cache empty, HKJC-only cards remain and say `資料不足，唔買`. With both present and unmatched, both fixture sets appear. With exact team/time/line match, one comparison card appears.

## Tasks
1. Add RED collector self-tests for dynamic active-soccer selection excluding winner/outright entries.
2. Replace the hard-coded eight-league list with free `/sports` discovery and preserve the 50-credit paid-call gate.
3. Make Dashboard refresh merge provider records by stable entry ID rather than rebuilding around HKJC.
4. Run collector dry-run, bounded live collection, full tests/build, API checks and browser smoke for all market tabs.
