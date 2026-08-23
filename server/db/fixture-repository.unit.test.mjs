import assert from "node:assert/strict";
import test from "node:test";

import { leaguesCompatible } from "./fixture-repository.mjs";
import { canonicalLeagueKey, canonicalTeamKey } from "../domain/fixture-aliases.mjs";

test("canonicalizes equivalent HDC and HKJC league labels", () => {
  const equivalent = [
    ["Brazil Série A", "Brazilian Division 1"],
    ["Brazil Série B", "Brazilian Division 2"],
    ["Primera División - Argentina", "Argentine Division 1"],
    ["Primera División - Chile", "Chilean Division 1"],
  ];

  for (const [hdc, hkjc] of equivalent) {
    assert.equal(leaguesCompatible(hdc, hkjc), true, `${hdc} should match ${hkjc}`);
  }
  assert.equal(leaguesCompatible("Brazil Série A", "Brazilian Division 2"), false);
});

// --- Production-reproduced cross-provider splits (2026-08-23 report §4.2) ---

test("Daejeon Citizen vs Gangwon FC: K League 1 matches Korean Division 1", () => {
  assert.equal(leaguesCompatible("K League 1", "Korean Division 1"), true);
  assert.equal(canonicalLeagueKey("K League 1"), canonicalLeagueKey("Korean Division 1"));
});

test("J League matches Japanese Division 1", () => {
  assert.equal(leaguesCompatible("J League", "Japanese Division 1"), true);
});

test("Machida Zelvia: FC prefix alias merges across providers", () => {
  assert.equal(canonicalTeamKey("FC Machida Zelvia"), canonicalTeamKey("Machida Zelvia"));
});

test("Urawa: Red Diamonds merges with Reds", () => {
  assert.equal(canonicalTeamKey("Urawa Red Diamonds"), canonicalTeamKey("Urawa Reds"));
});

test("Gwangju vs Incheon: Utd merges with United", () => {
  assert.equal(canonicalTeamKey("Incheon Utd"), canonicalTeamKey("Incheon United"));
});

// --- Safety boundaries: these must never merge ---

test("Manchester never matches Manchester United", () => {
  assert.notEqual(canonicalTeamKey("Manchester"), canonicalTeamKey("Manchester United"));
});

test("women's teams never merge with men's teams", () => {
  assert.notEqual(canonicalTeamKey("Arsenal Women"), canonicalTeamKey("Arsenal"));
  assert.notEqual(canonicalTeamKey("Manchester United Women"), canonicalTeamKey("Manchester United"));
});

test("different teams stay distinct", () => {
  assert.notEqual(canonicalTeamKey("Gwangju FC"), canonicalTeamKey("Incheon United"));
  assert.equal(canonicalTeamKey("Tottenham Hotspur"), canonicalTeamKey("Tottenham Hotspur"));
});
