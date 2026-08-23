import assert from "node:assert/strict";
import test from "node:test";

import { dueOddsSports, priorityCornerEvents } from "./hdc-collector.mjs";

const NOW = Date.parse("2026-08-23T12:00:00Z");
const BIG_FIVE = [
  "soccer_epl",
  "soccer_spain_la_liga",
  "soccer_italy_serie_a",
  "soccer_germany_bundesliga",
  "soccer_france_ligue_one",
];

test("automatically takes the final five-minute odds sample for the Big Five only", () => {
  const sports = [...BIG_FIVE, "soccer_usa_mls"];
  const state = {
    events: Object.fromEntries(sports.map((sport) => [sport, [{
      id: `${sport}-fixture`,
      commence_time: new Date(NOW + 4 * 60_000).toISOString(),
    }]])),
    lastOddsAt: Object.fromEntries(sports.map((sport) => [
      sport,
      new Date(NOW - 16 * 60_000).toISOString(),
    ])),
  };

  assert.deepEqual(dueOddsSports(state, NOW), BIG_FIVE);
});

test("Big Five corner samples bypass the legacy priority-team gate", () => {
  const events = [{ id: "ars-che", home_team: "Arsenal", away_team: "Chelsea" }];
  const unrelatedPriority = new Set(["aberdeen"]);

  for (const sport of BIG_FIVE) {
    assert.deepEqual(
      priorityCornerEvents(events, unrelatedPriority, { sport }),
      events,
      `${sport} should keep its scheduled corner sample`,
    );
  }

  assert.deepEqual(
    priorityCornerEvents(events, unrelatedPriority, { sport: "soccer_usa_mls" }),
    [],
    "non-Big-Five leagues remain protected by the quota-saving priority gate",
  );
});
