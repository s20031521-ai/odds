import test from "node:test";
import assert from "node:assert/strict";

import { parseFootballDataCsv, inferSeason } from "./lib/football-data-csv.mjs";
import { importRows } from "./import-historical-scores.mjs";

const HEADER = "Div,Date,Time,HomeTeam,AwayTeam,FTHG,FTAG,FTR,B365H,B365D,B365A,PSH,PSD,PSA,B365>2.5,B365<2.5,P>2.5,P<2.5,AHh,B365AHH,B365AHA,PAHH,PAHA";

test("parser maps a full row with Pinnacle closing odds preferred", () => {
  const csv = `${HEADER}\nE0,10/08/2024,17:30,Man United,Fulham,1,0,H,1.72,4.00,5.00,1.75,3.90,4.80,1.85,2.05,1.88,1.98,-0.75,1.90,2.00,1.95,1.95`;
  const rows = parseFootballDataCsv(csv, { leagueCode: "E0" });
  assert.equal(rows.length, 1);
  const [row] = rows;
  assert.equal(row.leagueCode, "E0");
  assert.equal(row.matchDate, "2024-08-10");
  assert.equal(row.homeTeam, "Man United");
  assert.equal(row.awayTeam, "Fulham");
  assert.equal(row.homeGoals, 1);
  assert.equal(row.awayGoals, 0);
  // Pinnacle preferred over Bet365 for h2h closing
  assert.equal(row.closingHomeOdds, 1.75);
  assert.equal(row.closingDrawOdds, 3.9);
  assert.equal(row.closingAwayOdds, 4.8);
  assert.equal(row.closingTotalsLine, 2.5);
  assert.equal(row.closingOverOdds, 1.88);
  assert.equal(row.closingUnderOdds, 1.98);
  assert.equal(row.closingHandicapLine, -0.75);
  assert.equal(row.closingHandicapHomeOdds, 1.95);
  assert.equal(row.closingHandicapAwayOdds, 1.95);
});

test("parser falls back to Bet365 when Pinnacle columns are empty", () => {
  const csv = `${HEADER}\nE0,11/08/2024,14:00,Arsenal,Wolves,2,0,H,1.30,5.50,11.00,,,,1.70,2.20,,,-1.5,1.90,2.00,,`;
  const [row] = parseFootballDataCsv(csv, { leagueCode: "E0" });
  assert.equal(row.closingHomeOdds, 1.3);
  assert.equal(row.closingOverOdds, 1.7);
  assert.equal(row.closingUnderOdds, 2.2);
  assert.equal(row.closingHandicapHomeOdds, 1.9);
  assert.equal(row.closingHandicapAwayOdds, 2.0);
});

test("parser skips unplayed rows (empty FTHG/FTAG)", () => {
  const csv = `${HEADER}\nE0,10/08/2024,17:30,Man United,Fulham,1,0,H,1.72,4.00,5.00,,,,,,,,,,,\nE0,17/08/2024,15:00,Spurs,Everton,,,,1.50,4.50,6.50,,,,,,,,,,,`;
  const rows = parseFootballDataCsv(csv, { leagueCode: "E0" });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].homeTeam, "Man United");
});

test("parser handles two-digit year dates and quoted team names with commas", () => {
  const csv = `Div,Date,HomeTeam,AwayTeam,FTHG,FTAG\nSP1,15/08/24,"Team, With Comma",Levante,3,1`;
  const [row] = parseFootballDataCsv(csv, { leagueCode: "SP1" });
  assert.equal(row.matchDate, "2024-08-15");
  assert.equal(row.homeTeam, "Team, With Comma");
  assert.equal(row.homeGoals, 3);
});

test("parser tolerates missing odds columns entirely", () => {
  const csv = `Div,Date,HomeTeam,AwayTeam,FTHG,FTAG\nE0,10/08/2024,Man United,Fulham,1,0`;
  const [row] = parseFootballDataCsv(csv, { leagueCode: "E0" });
  assert.equal(row.closingHomeOdds, null);
  assert.equal(row.closingTotalsLine, null);
  assert.equal(row.closingHandicapLine, null);
});

test("parser strips a UTF-8 BOM so the Div column still maps", () => {
  const csv = `﻿Div,Date,HomeTeam,AwayTeam,FTHG,FTAG\nE0,16/08/2024,Man United,Fulham,1,0`;
  const [row] = parseFootballDataCsv(csv);
  assert.equal(row.leagueCode, "E0");
});

test("inferSeason rolls July-and-later into the new season", () => {
  assert.equal(inferSeason("2024-08-10"), "2024-25");
  assert.equal(inferSeason("2025-05-25"), "2024-25");
  assert.equal(inferSeason("2024-07-01"), "2024-25");
  assert.equal(inferSeason("2025-06-30"), "2024-25");
});

test("importRows upserts with the unique key and reports counts", async () => {
  const queries = [];
  const fakePool = {
    async query(sql, params) {
      queries.push({ sql, params });
      return { rows: [{ inserted: true }] };
    },
  };
  const rows = parseFootballDataCsv(
    `${HEADER}\nE0,10/08/2024,17:30,Man United,Fulham,1,0,H,1.72,4.00,5.00,1.75,3.90,4.80,,,,,,,,,`,
    { leagueCode: "E0" },
  );
  const result = await importRows(fakePool, rows, { source: "football-data.co.uk" });
  assert.equal(result.processed, 1);
  assert.equal(queries.length, 1);
  assert.match(queries[0].sql, /INSERT INTO team_match_history/);
  assert.match(queries[0].sql, /ON CONFLICT \(source, league_code, match_date, home_team, away_team\)/);
  assert.equal(queries[0].params[1], "E0");
  assert.equal(queries[0].params[2], "2024-25");
  // running twice stays idempotent at the SQL level (same upsert, no dupes by constraint)
  await importRows(fakePool, rows, { source: "football-data.co.uk" });
  assert.equal(queries.length, 2);
  assert.equal(queries[1].sql, queries[0].sql);
});
