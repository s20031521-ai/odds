import assert from "node:assert/strict";
import test from "node:test";

import { settlePersonalBet } from "./personal-bet-sample.mjs";

test("settlePersonalBet: handicap without line uses score moneyline", () => {
  const bet = {
    settlement: "pending",
    match_id: "hkjc-50071288",
    market: "handicap",
    selection: "home",
    line: null,
  };
  const results = [
    { matchId: "hkjc-50071288", score: "3-1", market: "亞洲讓球" },
  ];
  assert.equal(settlePersonalBet(bet, results), "win");
});

test("settlePersonalBet: home loss on score", () => {
  const bet = {
    settlement: "pending",
    match_id: "m1",
    market: "handicap",
    selection: "home",
    line: null,
  };
  assert.equal(settlePersonalBet(bet, [{ matchId: "m1", score: "0-2" }]), "loss");
});

test("settlePersonalBet: already settled returns null", () => {
  const bet = {
    settlement: "win",
    match_id: "m1",
    market: "h2h",
    selection: "home",
  };
  assert.equal(settlePersonalBet(bet, [{ matchId: "m1", score: "1-0" }]), null);
});

test("settlePersonalBet: handicap with line uses asian settle", () => {
  const bet = {
    settlement: "pending",
    match_id: "m2",
    market: "handicap",
    selection: "home",
    line: -0.5,
  };
  // home wins 1-0 by 1 → covers -0.5 → win
  assert.equal(settlePersonalBet(bet, [{ matchId: "m2", score: "1-0" }]), "win");
});
