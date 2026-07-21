# SDD progress — simple-dashboard-mode (2026-07-19)
Plan: docs/superpowers/plans/2026-07-19-simple-dashboard-mode.md
Task 1: complete (commits 645f22a..3d8480c, review clean)
Minor: storage-key literal untested; LF/CRLF warning noise — .gitattributes someday
Task 2: complete (commits 3d8480c..e20e54b, review clean; plan-mandated helper duplication accepted by owner 2A; formatLine drops + per approved mockup)
Minor: formatDate locale-dependent; empty-state lacks role=status; negative-guard tests brittle to format changes
Task 3: complete (commits e20e54b..75a4c84, review clean)
Minor: click-write path untestable under renderToStaticMarkup; UMD-global React type usage
Task 4: complete (commits 75a4c84..4e4cf0d, review clean; App.test.tsx 2 wiring assertions rewired 1:1)
ALL TASKS COMPLETE — pending final whole-branch review (merge-base 645f22a)
MERGED to master (ff 645f22a..4e4cf0d); tests on merged result 183/183 green; branch deleted

# SDD progress — team-logos (2026-07-20)
Plan: docs/superpowers/plans/2026-07-20-team-logos.md
Task 1: complete (commits 2439fe2..b7a9b67, review clean)
Minor: surrogate-pair edge in initials; --color-muted badge contrast
Task 2: complete (commits b7a9b67..2df07da, review clean; controller resolved CSS ⚠️ via Task 1 .match-teams)
Minor: h2-containment assertion relaxed; vacuous negative assertion; tsc TS2741 until Task 4
Task 3: complete (commits 2df07da..e3cffa9, review clean; agent-13 did work before quota-die, agent-14 verified)
Minor: logo position ordering untested; h2-containment relaxed (same as Task 2)
Task 4: complete (commits e3cffa9..a5b90e3, review clean; suite 192/192 green, tsc+build pass)
Minor: teams-array typeof edge (benign); pro-mode passthrough untested
Task 5: complete (commits a5b90e3..34d72fc, review clean)
Minor: console noise in tests; pickTeamResult only checks response[0]; API header/URL unasserted; falsy-id guard theoretical
ALL TASKS COMPLETE — pending final whole-branch review (merge-base 2439fe2)
MERGED to master (ff 2439fe2..50bd070); branch deleted

# SDD progress — today-first-ui phase A (2026-07-21)
Plan: docs/superpowers/plans/2026-07-21-today-first-ui-phase-a-today-page.md
Task 4 plan-mandated helper duplication vs SimpleDashboard accepted by owner (2A), cleanup in Phase C
Task 1: complete (commits 5b2ab7b..4684a69, review clean)
Minor: #/dashboard->today asserted twice (harmless)
Task 2: complete (commits 4684a69..77da717, review clean)
Minor: AppShell.test.tsx renderShell route union still has "dashboard" (Task 10 tsc gate must sweep, union should be today|fixtures|analysis|history)
Task 3: complete (commits 77da717..2c176f6, review clean; ⚠️ App.tsx defaults match confirmed via prior exploration L134-139)
Minor: confused leftover comments in stakeDisplay.test.ts:13-14 (plan-mandated verbatim); no chance>1/NaN test; Math.round can zero tiny stakes
Task 4: complete (commits 2c176f6..76a0b74, review clean)
Minor: Edge +-x0n negative edge; 1/odds unguarded vs Infinity%; aria-hidden toggle affordance; pickKey collision theoretical (all plan-mandated verbatim)
Task 5: complete (commits 76a0b74..22765cb, review clean)
Minor: React UMD global type ref (plan-mandated); Math.round vs floor minute semantics; stale test doesnt assert base class
Task 6: complete (commits 22765cb..83e4e18, review clean)
Minor: React UMD global type ref (plan-mandated)
Task 7: complete (commits 83e4e18..54f5127, review clean)
Minor: <details>-count assertion coupled to PickCard internals; cap test doesnt assert which 5; upcoming section renders empty ul (all plan-mandated)
Task 8: complete (commits 54f5127..80b4b80, review clean; token + class-collision checks clean)
Minor: Firefox ::marker counterpart omitted (plan-mandated)
Task 9: complete (commits 80b4b80..94952f3, review clean; ⚠️ SimpleDashboard on disk verified; App.tsx fixtures prop pending Task 10)
Minor: pro-test negative assertion changed beyond brief wording (harmless); onShowAll click behavior untested; stale copy now diverges simple vs pro (design-level, Phase C)
Task 10: complete (commits 94952f3..2544f60, review clean; tsc=0, vitest 226/226; 4th inverted guard site handled; renderShell swept)
Minor: brief said 3 sites but 4 existed (absorbed correctly)
Task 11: complete (commits 2544f60..67f35af, review clean; extraction faithful, 32/32; #/today URL assertion accepted as rename follow-through)
Minor: stale comment in helpers.ts re pro default; report line-count cosmetic inaccuracy; stale dist caused initial failures (rebuild before gating!)
Task 12: complete (commits 67f35af..3509919, review clean; 52/52 first run)
Minor: h1 selector page-global; freshness test asserts attr not visibility (plan-mandated); FUTURE_KICKOFF=2030 durability debt (fails after 2030-07-17, future hardening)
Task 13: complete (controller-run verification: vitest 226/226, tsc 0 errors, vite build OK, playwright 52/52; red-line files zero diff vs v1.0.2; no stale nav labels; #/dashboard only in expected alias tests)
ALL TASKS COMPLETE — pending final whole-branch review (merge-base 5b2ab7b)
MERGED to master (ff 5b2ab7b..e837c02); tests on merged result 226/226 green + tsc clean; branch deleted
Final review: ready-to-merge=yes; fix e837c02 added onShowAll click coverage (56/56 playwright)
Deferred minors recorded for Phase B/C: raw ISO 賠率同步於 formatting; upcoming section visible when stale; FUTURE_KICKOFF 2030 time bomb; stale-copy divergence simple vs pro
