// Downloads Understat per-match xG for the five top leagues into
// data/understat/<league>-<seasonStart>.json (raw getLeagueData payloads,
// cached so re-runs are incremental). Offline training data (ADR 0003).
//
// Usage:
//   node scripts/fetch-understat-xg.mjs                      # all leagues, 2014..current
//   node scripts/fetch-understat-xg.mjs --league E0 --from 2020 --to 2025
//   node scripts/fetch-understat-xg.mjs --force              # re-download cached files
//   node scripts/fetch-understat-xg.mjs --self-test
//
// Be polite: one request per second. ~60 files total on a full run.

import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  FIRST_SEASON_START,
  UNDERSTAT_LEAGUES,
  leagueDataUrl,
  parseLeagueData,
} from "./lib/understat-xg.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(root, "data", "understat");
const REQUEST_DELAY_MS = 1000;

function currentSeasonStart(now = new Date()) {
  // Season starting in year Y runs Aug Y → May Y+1; before July we still
  // belong to the season that started last year.
  const year = now.getUTCFullYear();
  return now.getUTCMonth() >= 6 ? year : year - 1;
}

function parseArgs(argv) {
  const args = { leagues: [], from: FIRST_SEASON_START, to: currentSeasonStart() };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--league") args.leagues.push(argv[++index].toUpperCase());
    else if (arg === "--from") args.from = Number.parseInt(argv[++index], 10);
    else if (arg === "--to") args.to = Number.parseInt(argv[++index], 10);
    else if (arg === "--force") args.force = true;
    else if (arg === "--self-test") args.selfTest = true;
  }
  if (args.leagues.length === 0) args.leagues = [...UNDERSTAT_LEAGUES.keys()];
  return args;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function selfTest() {
  const payload = {
    dates: [
      { isResult: true, h: { title: "Manchester United" }, a: { title: "Fulham" },
        goals: { h: "1", a: "0" }, xG: { h: "2.04268", a: "0.418711" },
        datetime: "2024-08-16 19:00:00" },
      { isResult: false, h: { title: "Arsenal" }, a: { title: "Chelsea" },
        goals: { h: null, a: null }, xG: { h: null, a: null },
        datetime: "2024-08-24 15:00:00" },
    ],
  };
  const rows = parseLeagueData(payload, { leagueCode: "E0", seasonStart: 2024 });
  if (rows.length !== 1) throw new Error(`expected 1 played row, got ${rows.length}`);
  const row = rows[0];
  if (row.season !== "2425" || row.matchDate !== "2024-08-16") throw new Error("season/date mapping failed");
  if (Math.abs(row.homeXg - 2.04268) > 1e-9 || Math.abs(row.awayXg - 0.418711) > 1e-9) {
    throw new Error("xG parse failed");
  }
  if (!leagueDataUrl("SP1", 2019).includes("La_liga/2019")) throw new Error("url mapping failed");
  console.log("[fetch-xg] self-test passed");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.selfTest) return selfTest();
  if (!Number.isInteger(args.from) || !Number.isInteger(args.to) || args.from > args.to) {
    throw new Error(`invalid season range ${args.from}..${args.to}`);
  }

  await mkdir(OUT_DIR, { recursive: true });
  const cached = new Set(await readdir(OUT_DIR));
  let downloaded = 0;
  let skipped = 0;

  for (const leagueCode of args.leagues) {
    if (!UNDERSTAT_LEAGUES.has(leagueCode)) throw new Error(`unknown league ${leagueCode}`);
    for (let seasonStart = args.from; seasonStart <= args.to; seasonStart += 1) {
      const fileName = `${leagueCode}-${seasonStart}.json`;
      if (!args.force && cached.has(fileName)) {
        skipped += 1;
        continue;
      }
      const response = await fetch(leagueDataUrl(leagueCode, seasonStart), {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) odds-research",
          "X-Requested-With": "XMLHttpRequest",
          Referer: `https://understat.com/league/${UNDERSTAT_LEAGUES.get(leagueCode).slug}/${seasonStart}`,
        },
      });
      if (!response.ok) throw new Error(`understat HTTP ${response.status} for ${leagueCode} ${seasonStart}`);
      const payload = await response.json();
      const rows = parseLeagueData(payload, { leagueCode, seasonStart });
      await writeFile(path.join(OUT_DIR, fileName), JSON.stringify(payload), "utf8");
      downloaded += 1;
      console.log(`[fetch-xg] ${leagueCode} ${seasonStart}: ${rows.length} played matches`);
      await sleep(REQUEST_DELAY_MS);
    }
  }
  console.log(`[fetch-xg] status=complete downloaded=${downloaded} cached=${skipped}`);
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(`[fetch-xg] status=failed ${error.message}`);
    process.exitCode = 1;
  });
}
