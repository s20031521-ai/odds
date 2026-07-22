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
=== Phase B: today-first UI match analysis (branch today-first-phase-b, base f37ffd5) ===
Task 1: complete (commits f37ffd5..5a1dff3, review clean; note: parser strict-equals 'analysis' vs pageFromHash startsWith — Task 6 wiring留意)
Task 2: complete (commits 5a1dff3..5131654, review clean; TotalsCard id/bestSide type deviation adjudicated necessary)
Minor: test factory lie cast bestSide; totals/corners header fallback無直接測試
Task 3: complete (commits 5131654..0297650, review clean)
Minor: match.css 冗餘 color rule; hardcode padding 16px (tokens 無 spacing token, 合理)
Task 4: complete (commits 0297650..9e43462, review clean)
Minor: picker link無垂直置中 (cosmetic); leagueZh ?? league ?: 靠 precedence (plan-mandated)
Task 5: complete (commits 9e43462..9808b08, review clean)
Task 6: complete (commits 9808b08..92fea7e, review clean; deep-link chain preserved statically, e2e coverage in Task 7)
Minor: clearBacktestResponseState readiness:[] 遷就簽名 — Phase C 簡化
Task 7: complete (commits 92fea7e..b03ac8f, review clean; plan-gap fix: analysis page加入 live odds autoload gate, controller-approved)
Minor: HDC interval gate仲受 analysisTab 限制 (同 today/fixtures 一致, 唔影響); dashboard.spec:44 一次 tablet-landscape flaky (timing race, 觀察中)
Task 8: complete (controller-run: vitest 245/245, tsc 0, build OK, playwright 76/76 x2 consecutive; red-line files zero diff; flaky dashboard.spec:44 tablet-landscape 1/3 runs — timing race, deferred, no retry added)
ALL TASKS COMPLETE — pending final whole-branch review (merge-base f37ffd5)
MERGED to master (ff f37ffd5..b03ac8f); branch deleted; merged result vitest 245/245

# SDD progress — unified-buyable-v1 (2026-07-22)
Plan: docs/superpowers/plans/2026-07-22-unified-buyable-v1.md
Branch base: 56c5aa4; plan commit: c140803
Task 1: complete (commits c140803..4610dfc, review clean; controller verified engine 11/11, wrappers 33/33, build pass)
Task 2: complete (commits 4610dfc..7bcf10a, static review clean; controller PostgreSQL 16.14 verified migration/repositories 41/41)
Task 3: complete (commits 7bcf10a..5000e46, review clean; controller PostgreSQL verified sampler/sink/repositories 37/37 + self-test)
Task 4: complete (commits 5000e46..d855c87, review clean after freshness/backtest-contract fixes; controller Node 13/13, Vitest 3/3, build pass)
Task 5: complete (commits d855c87..1f53d60, review clean after canonical-market/polling fixes; controller focused 60/60, build pass; BuyDashboard zero diff)
Task 6: complete (commits 1f53d60..53073d6, review clean after corners/stale-peer fixes; controller PostgreSQL 66/66 + affected 14/14 + 3 self-tests)
Task 7: complete (commits 53073d6..0c13648, review clean after strategy-aware integrity fix; controller 35 pass/0 fail/1 Windows symlink skip)
Task 8: complete (commits 0c13648..ea2c4e6, full verification re-run by controller on resume: vitest 264/264, build pass, 5 self-tests pass, server+db 63/63, sink/collector-pg/integrity 50/50, legacy 6 pass/1 symlink skip, playwright 84/84; red-line zero diff, LF clean; uncommitted UI-test refinement from prior session verified green and committed)
Final whole-branch review (merge-base 56c5aa4, HEAD 521eda5): ready-to-merge=with-fixes; Important #1 handoff archive ref fixed (docs: pin to 521eda5); Minor #3 integrity COALESCE premise disproven by fix agent's RED test (already coalesced; dead SELECT column only)
Deferred minors for later: fixture kickoff only moves later (asymmetry undocumented); reconcile stamps empty obs on provider-gap making closing benchmark N/A; arbitrary strategy strings persistable via legacy POST; opportunity identity derived in 4 places (consolidation ticket); readiness unified-only even when zero unified data (plan-mandated); hand-rolled SHA-256 lacks why-comment
ALL TASKS COMPLETE — unified-buyable-v1
MERGED to master (ff 56c5aa4..a1c0a60); tests on merged result 264/264 green + build clean; worktree removed; branch deleted
Production backup/migration/deploy/tag/monitoring remain operator actions per docs/HANDOFF-2026-07-22-unified-buyable-v1.md
