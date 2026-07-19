import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createStorageBackend } from "./lib/storage-backend.mjs";
import { createResultRepository } from "../server/db/result-repository.mjs";
import { createSnapshotRepository } from "../server/db/snapshot-repository.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outPath = path.join(root, "public", "hkjc-odds.json");
const resultArchivePath = path.join(root, "data", "result-archive.jsonl");
const predictionsPath = path.join(root, "data", "prediction-snapshots.jsonl");
const apiFootballStatePath = path.join(root, "data", "api-football-state.json");
const cornerOverridesPath = path.join(root, "data", "corner-result-overrides.json");
const endpoint = "https://info.cld.hkjc.com/graphql/base/";
const apiFootballEndpoint = "https://v3.football.api-sports.io";
const API_FOOTBALL_DAILY_LIMIT = 90;
const API_FOOTBALL_RESULT_LIMIT = 60;

try {
  process.loadEnvFile(path.join(root, ".env.local"));
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

const query = `
      query matchList($startIndex: Int, $endIndex: Int,$startDate: String, $endDate: String, $matchIds: [String], $tournIds: [String], $fbOddsTypes: [FBOddsType]!, $fbOddsTypesM: [FBOddsType]!, $inplayOnly: Boolean, $featuredMatchesOnly: Boolean, $frontEndIds: [String], $earlySettlementOnly: Boolean, $showAllMatch: Boolean) {
        matches(startIndex: $startIndex,endIndex: $endIndex, startDate: $startDate, endDate: $endDate, matchIds: $matchIds, tournIds: $tournIds, fbOddsTypes: $fbOddsTypesM, inplayOnly: $inplayOnly, featuredMatchesOnly: $featuredMatchesOnly, frontEndIds: $frontEndIds, earlySettlementOnly: $earlySettlementOnly, showAllMatch: $showAllMatch) {
          id
          frontEndId
          matchDate
          kickOffTime
          status
          updateAt
          sequence
          esIndicatorEnabled
          homeTeam {
            id
            name_en
            name_ch
          }
          awayTeam {
            id
            name_en
            name_ch
          }
          tournament {
            id
            frontEndId
            nameProfileId
            isInteractiveServiceAvailable
            code
            name_en
            name_ch
          }
          isInteractiveServiceAvailable
          inplayDelay
          venue {
            code
            name_en
            name_ch
          }
          tvChannels {
            code
            name_en
            name_ch
          }
          liveEvents {
            id
            code
          }
          featureStartTime
          featureMatchSequence
          poolInfo {
            normalPools
            inplayPools
            sellingPools
            ntsInfo
            entInfo
            definedPools
            ngsInfo {
              str
              name_en
              name_ch
              instNo
            }
            agsInfo {
              str
              name_en
              name_ch
            }
          }
          runningResult {
            homeScore
            awayScore
            corner
            homeCorner
            awayCorner
          }
          runningResultExtra {
            homeScore
            awayScore
            corner
            homeCorner
            awayCorner
          }
          adminOperation {
            remark {
              typ
            }
          }
          foPools(fbOddsTypes: $fbOddsTypes) {
            id
            status
            oddsType
            instNo
            inplay
            name_ch
            name_en
            updateAt
            expectedSuspendDateTime
            lines {
              lineId
              status
              condition
              main
              combinations {
                combId
                str
                status
                offerEarlySettlement
                currentOdds
                selections {
                  selId
                  str
                  name_ch
                  name_en
                }
              }
            }
          }
        }
      }
      `;

const historicQuery = `
query matchResults($startDate: String, $endDate: String, $startIndex: Int,$endIndex: Int,$teamId: String) {
timeOffset {
fb
}
matchNumByDate(startDate: $startDate, endDate: $endDate, teamId: $teamId) {
total
}
matches: matchResult(startDate: $startDate, endDate: $endDate, startIndex: $startIndex,endIndex: $endIndex, teamId: $teamId) {
id
status
frontEndId
matchDayOfWeek
matchNumber
matchDate
kickOffTime
sequence
homeTeam {
id
name_en
name_ch
}
awayTeam {
id
name_en
name_ch
}
tournament {
code
name_en
name_ch
}
results {
homeResult
awayResult
ttlCornerResult
resultConfirmType
payoutConfirmed
stageId
resultType
sequence
}
poolInfo {
payoutRefundPools
refundPools
ntsInfo
entInfo
definedPools
ngsInfo {
str
name_en
name_ch
instNo
}
agsInfo {
str
name_en
name_ch
}
}
}
}`;

const variables = {
  startIndex: null,
  endIndex: null,
  startDate: null,
  endDate: null,
  matchIds: null,
  tournIds: null,
  fbOddsTypes: ["HAD", "HIL", "CHL", "HDC"],
  fbOddsTypesM: ["HAD", "HIL", "CHL", "HDC"],
  inplayOnly: false,
  featuredMatchesOnly: false,
  frontEndIds: null,
  earlySettlementOnly: false,
  showAllMatch: true,
};

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly && process.argv.includes("--self-test")) {
  const sample = parseMatches([
    {
      id: "m1",
      kickOffTime: "2026-07-08T21:58:00.000+08:00",
      homeTeam: { name_ch: "主隊", name_en: "Home" },
      awayTeam: { name_ch: "客隊", name_en: "Away" },
      tournament: { code: "EPL", name_en: "English Premier League", name_ch: "英格蘭超級聯賽" },
      foPools: [
        {
          oddsType: "HAD",
          lines: [
            {
              combinations: [
                { str: "H", currentOdds: "2.10" },
                { str: "D", currentOdds: "3.20" },
                { str: "A", currentOdds: "3.40" },
              ],
            },
          ],
        },
        {
          oddsType: "HDC",
          lines: [{
            condition: "0.0/+0.5",
            main: true,
            combinations: [{ str: "H", currentOdds: "1.72" }, { str: "A", currentOdds: "2.00" }],
          }],
        },
        {
          oddsType: "CHL",
          lines: [
            {
              condition: "8.5",
              combinations: [
                { str: "H", currentOdds: "1.91" },
                { str: "L", currentOdds: "1.83" },
              ],
            },
          ],
        },
      ],
    },
  ]);
  const sampleResults = parseResultRecords([
    {
      id: "m2",
      status: "FULLTIME",
      kickOffTime: "2026-07-08T21:58:00.000+08:00",
      homeTeam: { name_ch: "主隊", name_en: "Home" },
      awayTeam: { name_ch: "客隊", name_en: "Away" },
      runningResult: { homeScore: 2, awayScore: 1, corner: 10, homeCorner: 6, awayCorner: 4 },
      foPools: [
        { oddsType: "HAD", lines: [{ combinations: [{ str: "H", currentOdds: "1.80" }, { str: "D", currentOdds: "3.20" }, { str: "A", currentOdds: "4.00" }] }] },
        { oddsType: "HIL", lines: [{ condition: "2.5", combinations: [{ str: "H", currentOdds: "1.70" }, { str: "L", currentOdds: "2.00" }] }] },
        { oddsType: "CHL", lines: [{ condition: "9.5", combinations: [{ str: "H", currentOdds: "1.60" }, { str: "L", currentOdds: "2.00" }] }] },
      ],
    },
  ]);
  const sampleHandicaps = parseHandicapMarkets([{
    id: "m1",
    kickOffTime: "2026-07-08T21:58:00.000+08:00",
    homeTeam: { name_ch: "主隊", name_en: "Home FC" },
    awayTeam: { name_ch: "客隊", name_en: "Away FC" },
    tournament: { code: "HKP", name_ch: "香港超級聯賽" },
    foPools: [{ oddsType: "HDC", lines: [{ main: true, condition: "0.0/+0.5", combinations: [{ str: "H", currentOdds: "1.72" }, { str: "A", currentOdds: "2.00" }] }] }],
  }]);
  const sampleCorners = parseHighLowMarkets([
    {
      id: "m1",
      kickOffTime: "2026-07-08T21:58:00.000+08:00",
      homeTeam: { name_ch: "主隊", name_en: "Home" },
      awayTeam: { name_ch: "客隊", name_en: "Away" },
      foPools: [
        {
          oddsType: "CHL",
          lines: [
            {
              condition: "8.5",
              combinations: [
                { str: "H", currentOdds: "1.91" },
                { str: "L", currentOdds: "1.83" },
              ],
            },
          ],
        },
      ],
    },
  ], "CHL", "chl");
  assert(sample.length === 1, "imports one complete HAD match");
  assert(sample[0].homeTeamZh === "主隊" && sample[0].awayTeamZh === "客隊", "keeps Chinese team names on HAD entries");
  assert(sampleHandicaps[0].homeTeamZh === "主隊" && sampleHandicaps[0].awayTeamZh === "客隊", "keeps Chinese team names on HDC entries");
  assert(sampleCorners[0].homeTeamZh === "主隊" && sampleCorners[0].awayTeamZh === "客隊", "keeps Chinese team names on CHL entries");
  const englishOnly = parseMatches([{
    id: "m3",
    kickOffTime: "2026-07-08T21:58:00.000+08:00",
    homeTeam: { name_en: "Only EN" },
    awayTeam: { name_en: "Away EN" },
    foPools: [{ oddsType: "HAD", lines: [{ combinations: [{ str: "H", currentOdds: "2.10" }, { str: "D", currentOdds: "3.20" }, { str: "A", currentOdds: "3.40" }] }] }],
  }]);
  assert(englishOnly.length === 1 && englishOnly[0].homeTeam === "Only EN" && englishOnly[0].homeTeamZh === undefined && englishOnly[0].awayTeamZh === undefined, "omits Chinese names when the provider has none while keeping English canonical names");
  assert(sample[0].league === "English Premier League", "maps the tournament English name to league");
  assert(sample[0].leagueZh === "英格蘭超級聯賽", "maps the tournament Chinese name to leagueZh");
  assert(sampleHandicaps[0].leagueZh === "香港超級聯賽", "keeps leagueZh on HDC entries");
  assert(sampleCorners[0].leagueZh === undefined, "omits leagueZh when the match has no tournament");
  assert(sampleHandicaps[0].league === "香港超級聯賽", "falls back to the tournament Chinese name when no English name exists");
  assert(sampleCorners[0].league === undefined, "omits league when the match has no tournament");
  assert(sample[0].homeTeam === "Home" && sampleCorners[0].homeTeam === "Home" && sampleHandicaps[0].homeTeam === "Home FC", "uses HKJC English names across markets");
  assert(sampleHandicaps.length === 1 && sampleHandicaps[0].line === 0.25, "imports and normalizes one HDC quarter line");
  assert(sampleHandicaps[0].homeTeamEn === "Home FC" && sampleHandicaps[0].homeOdds === 1.72 && sampleHandicaps[0].awayOdds === 2, "keeps HDC English names and H/A odds");
  assert(sample[0].odds.home === 2.1 && sample[0].odds.draw === 3.2 && sample[0].odds.away === 3.4, "maps H/D/A odds");
  assert(sampleCorners.length === 1, "imports one complete CHL match");
  assert(sampleCorners[0].line === 8.5 && sampleCorners[0].overOdds === 1.91 && sampleCorners[0].underOdds === 1.83, "maps corner high/low odds");
  assert(sampleResults.length === 4, "imports completed HAD/HDC/HIL/CHL comparisons");
  assert(sampleResults.filter((row) => row.market !== "亞洲讓球").every((row) => row.hit), "marks result-time legacy market picks while HDC waits for snapshots");
  assert(sampleResults.find((row) => row.market === "亞洲讓球")?.actual === "2-1", "stores final score for HDC settlement");
  assert(actualHad(0, 0) === "和局", "normalizes completed draws to dashboard labels");
  const stagedHistoric = parseHistoricResultRecords([{
    id: "staged",
    kickOffTime: "2026-07-10T18:30:00.000+08:00",
    homeTeam: { name_ch: "主隊" },
    awayTeam: { name_ch: "客隊" },
    results: [
      { homeResult: 1, awayResult: 0, stageId: 3, resultType: 1, sequence: 1 },
      { homeResult: 5, awayResult: 0, ttlCornerResult: 7, stageId: 5, resultType: 1, sequence: 2 },
    ],
  }]);
  assert(stagedHistoric.find((row) => row.market === "大細波")?.actual === "5 球", "uses full-time stage instead of the first partial result");
  assert(stagedHistoric.find((row) => row.market === "角球")?.actual === "7 角球", "uses full-time corner total");
  const invalidHistoric = parseHistoricResultRecords([{
    id: "invalid-score",
    results: [{ homeResult: -1, awayResult: -1, stageId: 5, resultType: 1 }],
  }]);
  assert(invalidHistoric.length === 0, "rejects provider sentinel scores");
  const mergedResults = mergeResultArchive(
    [{ id: "stale", matchId: "hkjc-m2", market: "主客和", actual: "主勝" }],
    [
      { id: "live", matchId: "hkjc-m2", market: "主客和", actual: "客勝" },
      { id: "historic", matchId: "hkjc-m2", market: "主客和", actual: "和局" },
    ],
  );
  assert(mergedResults.length === 1, "collapses live and historic result IDs by match and market");
  assert(mergedResults[0].id === "historic" && mergedResults[0].actual === "和局", "prefers the latest incoming corrected result");
  const historicPages = [];
  const pagedMatches = await paginateHistoricMatches(async (startIndex, endIndex) => {
    historicPages.push([startIndex, endIndex]);
    return startIndex === 1
      ? Array.from({ length: 20 }, (_, index) => ({ id: `historic-${index + 1}` }))
      : [{ id: "historic-21" }];
  });
  assert(historicPages.length === 2 && historicPages[1][0] === 21 && historicPages[1][1] === 40, "paginates historic results in pages of 20 until a short page");
  assert(pagedMatches.length === 21, "combines all historic result pages");
  let duplicatePageCalls = 0;
  const duplicatePage = Array.from({ length: 20 }, (_, index) => ({ id: `same-${index}` }));
  await paginateHistoricMatches(async () => {
    duplicatePageCalls += 1;
    return duplicatePage;
  });
  assert(duplicatePageCalls === 2, "stops historic pagination when a page adds no matches");
  assert(parseMatches([{ id: "bad", foPools: [] }]).length === 0, "skips incomplete match");
  const apiFixture = matchApiFootballFixture(
    { kickOffTime: "2026-07-11T18:30:00.000+08:00", homeTeam: { name_en: "Ulsan HD" }, awayTeam: { name_en: "Jeonbuk Motors" } },
    [{ fixture: { id: 123, date: "2026-07-11T18:30:00+08:00" }, teams: { home: { name: "Ulsan Hyundai FC" }, away: { name: "Jeonbuk Motors" } } }],
  );
  assert(apiFixture?.fixture?.id === 123, "matches API-Football fixture by kickoff and English team names");
  assert(apiFootballCornerTotal({ response: [
    { statistics: [{ type: "Corner Kicks", value: 6 }] },
    { statistics: [{ type: "Corner Kicks", value: 4 }] },
  ] }) === 10, "sums API-Football home and away corners");
  assert(apiFootballCornerTotal({ response: [{ statistics: [{ type: "Corner Kicks", value: null }] }] }) === null, "rejects incomplete API-Football corner statistics");
  const overrideRows = parseCornerResultOverrides([
    { matchId: "hkjc-m2", totalCorners: 9, sourceUrl: "https://www.fotmob.com/matches/example", verifiedAt: "2026-07-12T00:00:00Z" },
  ], sampleResults);
  assert(overrideRows.length === 1 && overrideRows[0].actual === "9 角球" && overrideRows[0].source === "manual:FOTMOB", "imports auditable corner result overrides");
  const cornerOdds = parseApiFootballCornerOdds({ response: [{ fixture: { id: 123 }, bookmakers: [
    { id: 1, name: "10Bet", bets: [{ name: "Corners Over Under", values: [{ value: "Over 10.5", odd: "1.85" }, { value: "Under 10.5", odd: "1.95" }] }] },
    { id: 2, name: "Broken", bets: [{ name: "Corners Over Under", values: [{ value: "Over 9.5", odd: "bad" }] }] },
  ] }] }, { id: "hkjc-1", homeTeam: { name_ch: "主隊" }, awayTeam: { name_ch: "客隊" }, kickOffTime: "2026-07-11T18:30:00+08:00" });
  assert(cornerOdds.length === 1 && cornerOdds[0].bookmaker === "10Bet" && cornerOdds[0].line === 10.5, "parses complete API-Football corner over/under pairs only");
  const budgetNow = Date.parse("2026-07-12T03:00:00Z");
  const budgetState = rollApiFootballDay({ utcDay: "2026-07-11", calls: 99, quotaExhausted: true }, budgetNow);
  assert(budgetState.utcDay === "2026-07-12" && budgetState.calls === 0 && !budgetState.quotaExhausted, "resets API-Football budget on a new UTC day");
  assert(apiFootballAllowed({ calls: 89, quotaExhausted: false }) && !apiFootballAllowed({ calls: 90, quotaExhausted: false }), "keeps ten daily requests in reserve");
  assert(resultDue({}, "m1", budgetNow, budgetNow - 151 * 60_000), "queries completed snapshotted matches after 150 minutes");
  assert(!resultDue({ m1: new Date(budgetNow - 11 * 60 * 60_000).toISOString() }, "m1", budgetNow, budgetNow - 151 * 60_000), "does not retry corner results inside 12 hours");
  assert(resultDue({ m1: new Date(budgetNow - 12 * 60 * 60_000).toISOString() }, "m1", budgetNow, budgetNow - 151 * 60_000), "retries unresolved corner results after 12 hours");
  assert(resultDue({ m1: "2026-07-12" }, "m1", budgetNow, budgetNow - 151 * 60_000), "migrates legacy day-only attempts into the 12-hour retry schedule");
  assert(oddsDue({}, "m1", budgetNow) && !oddsDue({ m1: new Date(budgetNow - 5 * 60_000).toISOString() }, "m1", budgetNow), "throttles pre-match corner odds retries");
  console.log("[hkjc-import] self-test passed");
  process.exit(0);
}

const LIVE_EXPIRY_MS = 3 * 60 * 60_000;
const HKJC_PROVIDER = "hkjc";

// File-mode store: preserves the legacy JSON/JSONL persistence byte-for-byte.
export function createFileStore() {
  return {
    backend: "file",
    async loadState() {
      return readJson(apiFootballStatePath, {});
    },
    async saveState(state) {
      await writeFile(apiFootballStatePath, JSON.stringify(state, null, 2) + "\n");
    },
    async loadSnapshots() {
      return readJsonl(predictionsPath);
    },
    async loadResults() {
      return readJsonl(resultArchivePath);
    },
    async saveResults(rows) {
      const existing = await readJsonl(resultArchivePath);
      const archived = mergeResultArchive(existing, rows);
      await writeFile(resultArchivePath, archived.map((row) => JSON.stringify(row)).join("\n") + (archived.length ? "\n" : ""));
    },
    async saveLive(payload) {
      await writeFile(outPath, JSON.stringify(payload, null, 2));
    },
  };
}

// Result source priorities for postgres mode only. The legacy importer stores
// every archived row at the repository default of 0, so any collector-written
// row outranks imported archive rows; among collector rows the scale preserves
// the file mode's last-wins correction order.
export function resultSourcePriority(row) {
  if (row?.source === "manual:FOTMOB") return 40;
  if (row?.source === "API-Football") return 30;
  if (String(row?.id ?? "").includes("-historic-")) return 20;
  return 10;
}

// Postgres-mode store: persists exclusively through the sink/repositories; writes no files.
export function createPostgresStore({ sink, pool }) {
  const snapshots = createSnapshotRepository(pool);
  const results = createResultRepository(pool);
  return {
    backend: "postgres",
    async loadState() {
      return (await sink.loadCollectorState("hkjc-import")) ?? {};
    },
    saveState: (state) => sink.saveCollectorState("hkjc-import", state),
    loadSnapshots: () => snapshots.listAll(),
    loadResults: () => results.listAll(),
    saveResults: (rows) => sink.saveResults(rows.map((row) => ({ ...row, sourcePriority: resultSourcePriority(row) }))),
    async saveLive(payload) {
      await sink.saveLiveOdds(HKJC_PROVIDER, payload.generatedAt, flattenHkjcLive(payload));
    },
  };
}

// Flattens the live payload's entries/totalEntries/cornerEntries/handicapEntries
// into the flat live-odds entry contract. resultEntries are intentionally NOT
// included (results live in the results table). Rows with non-positive-finite
// odds are dropped before the repository can reject the whole batch.
export function flattenHkjcLive(payload) {
  const flat = [];
  const fallbackMs = Date.parse(payload?.generatedAt ?? "");
  const base = (entry) => {
    const commenceMs = Date.parse(entry.commenceTime ?? "");
    return {
      matchId: entry.matchId,
      homeTeam: entry.homeTeam,
      awayTeam: entry.awayTeam,
      commenceTime: entry.commenceTime,
      bookmaker: entry.bookmaker,
      expiresAt: new Date((Number.isFinite(commenceMs) ? commenceMs : fallbackMs) + LIVE_EXPIRY_MS).toISOString(),
      ...(entry.league ? { league: entry.league } : {}),
      ...(entry.leagueZh ? { leagueZh: entry.leagueZh } : {}),
      ...(entry.homeTeamZh ? { homeTeamZh: entry.homeTeamZh } : {}),
      ...(entry.awayTeamZh ? { awayTeamZh: entry.awayTeamZh } : {}),
      raw: entry,
    };
  };
  const push = (entry, market, selection, line, odds) => {
    if (!Number.isFinite(odds) || odds <= 0) return;
    flat.push({ ...base(entry), id: `${entry.id}:${selection}`, market, selection, ...(line === undefined ? {} : { line }), odds });
  };
  for (const entry of payload?.entries ?? []) {
    push(entry, "h2h", "home", undefined, entry.odds?.home);
    push(entry, "h2h", "draw", undefined, entry.odds?.draw);
    push(entry, "h2h", "away", undefined, entry.odds?.away);
  }
  for (const entry of payload?.totalEntries ?? []) {
    push(entry, "totals", "over", entry.line, entry.overOdds);
    push(entry, "totals", "under", entry.line, entry.underOdds);
  }
  for (const entry of payload?.cornerEntries ?? []) {
    push(entry, "corners", "over", entry.line, entry.overOdds);
    push(entry, "corners", "under", entry.line, entry.underOdds);
  }
  for (const entry of payload?.handicapEntries ?? []) {
    // Both sides share the same line so the frontend's line-keyed grouping re-pairs them.
    push(entry, "spreads", "home", entry.line, entry.homeOdds);
    push(entry, "spreads", "away", entry.line, entry.awayOdds);
  }
  return flat;
}

async function runImport() {
  const storage = await createStorageBackend(process.env);
  const store = storage.backend === "postgres"
    ? createPostgresStore({ sink: storage.sink, pool: storage.pool })
    : createFileStore();
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Referer: "https://bet.hkjc.com/ch/football/home" },
      body: JSON.stringify({ query, variables }),
    });
    const payload = await response.json();
    if (!response.ok || payload.errors) {
      throw new Error(payload.errors?.[0]?.message ?? `HKJC API ${response.status}`);
    }

    await mkdir(path.dirname(outPath), { recursive: true });
    const now = Date.now();
    const apiFootballState = rollApiFootballDay(await store.loadState(), now);
    const predictions = await store.loadSnapshots();
    const entries = parseMatches(payload.data?.matches ?? []);
    const totalEntries = parseHighLowMarkets(payload.data?.matches ?? [], "HIL", "hil");
    const hkjcCornerEntries = parseHighLowMarkets(payload.data?.matches ?? [], "CHL", "chl");
    const handicapEntries = parseHandicapMarkets(payload.data?.matches ?? []);
    const historicMatches = await fetchHistoricMatches();
    const hkjcResultEntries = [
      ...parseResultRecords(payload.data?.matches ?? []),
      ...parseHistoricResultRecords(historicMatches),
    ];
    const existingArchive = await store.loadResults();
    const cornerOverrides = parseCornerResultOverrides(await readJson(cornerOverridesPath, []), [...existingArchive, ...hkjcResultEntries]);
    const apiFootballCornerEntries = await fetchApiFootballCornerResults(
      historicMatches,
      predictions,
      [...existingArchive, ...hkjcResultEntries, ...cornerOverrides],
      apiFootballState,
      now,
    );
    await fetchApiFootballCornerOdds(payload.data?.matches ?? [], predictions, apiFootballState, now);
    apiFootballState.cornerOdds = (apiFootballState.cornerOdds ?? []).filter((row) => Date.parse(row.commenceTime) + 3 * 60 * 60_000 > now);
    const cornerEntries = [...hkjcCornerEntries, ...apiFootballState.cornerOdds];
    const resultEntries = [...hkjcResultEntries, ...cornerOverrides, ...apiFootballCornerEntries];
    await store.saveResults(resultEntries);
    await store.saveState(apiFootballState);
    await store.saveLive({ generatedAt: new Date().toISOString(), entries, totalEntries, cornerEntries, handicapEntries, resultEntries }, now);
    const destination = store.backend === "postgres" ? "postgres" : outPath;
    console.log(`[hkjc-import] wrote ${entries.length} HAD entries, ${totalEntries.length} HIL entries, ${cornerEntries.length} CHL entries, ${handicapEntries.length} HDC entries and ${resultEntries.length} result comparisons to ${destination}`);
  } finally {
    await storage.close();
  }
}

if (invokedDirectly) {
  await runImport();
}

function parseMatches(matches) {
  return (Array.isArray(matches) ? matches : []).flatMap((match) => {
    const pool = match?.foPools?.find((item) => item?.oddsType === "HAD");
    const line = pool?.lines?.find((item) => item?.main !== false) ?? pool?.lines?.[0];
    const odds = Object.fromEntries((line?.combinations ?? []).map((comb) => [comb?.str, Number(comb?.currentOdds)]));
    if (![odds.H, odds.D, odds.A].every((value) => Number.isFinite(value) && value > 1)) {
      return [];
    }
    return {
      id: `hkjc-${match.id}`,
      matchId: `hkjc-${match.id}`,
      homeTeam: match.homeTeam?.name_en || match.homeTeam?.name_ch,
      awayTeam: match.awayTeam?.name_en || match.awayTeam?.name_ch,
      homeTeamZh: match.homeTeam?.name_ch || undefined,
      awayTeamZh: match.awayTeam?.name_ch || undefined,
      commenceTime: match.kickOffTime,
      bookmaker: "HKJC",
      league: match.tournament?.name_en || match.tournament?.name_ch || undefined,
      leagueZh: match.tournament?.name_ch || undefined,
      odds: { home: odds.H, draw: odds.D, away: odds.A },
    };
  });
}

function parseHandicapMarkets(matches) {
  return (Array.isArray(matches) ? matches : []).flatMap((match) => {
    const pool = match?.foPools?.find((item) => item?.oddsType === "HDC");
    const line = pool?.lines?.find((item) => item?.main !== false) ?? pool?.lines?.[0];
    const odds = Object.fromEntries((line?.combinations ?? []).map((comb) => [comb?.str, Number(comb?.currentOdds)]));
    const point = parseLine(line?.condition);
    if (![odds.H, odds.A, point].every(Number.isFinite) || odds.H <= 1 || odds.A <= 1) return [];
    return [{
      id: `hkjc-${match.id}-hdc-${point}`,
      matchId: `hkjc-${match.id}`,
      homeTeam: match.homeTeam?.name_en || match.homeTeam?.name_ch,
      awayTeam: match.awayTeam?.name_en || match.awayTeam?.name_ch,
      homeTeamEn: match.homeTeam?.name_en,
      awayTeamEn: match.awayTeam?.name_en,
      homeTeamZh: match.homeTeam?.name_ch || undefined,
      awayTeamZh: match.awayTeam?.name_ch || undefined,
      commenceTime: match.kickOffTime,
      bookmaker: "HKJC",
      league: match.tournament?.name_en || match.tournament?.name_ch || undefined,
      leagueZh: match.tournament?.name_ch || undefined,
      line: point,
      homeOdds: odds.H,
      awayOdds: odds.A,
    }];
  });
}

function parseHighLowMarkets(matches, oddsType, suffix) {
  return (Array.isArray(matches) ? matches : []).flatMap((match) => {
    const pool = match?.foPools?.find((item) => item?.oddsType === oddsType);
    const line = pool?.lines?.find((item) => item?.main !== false) ?? pool?.lines?.[0];
    const odds = Object.fromEntries((line?.combinations ?? []).map((comb) => [comb?.str, Number(comb?.currentOdds)]));
    const point = parseLine(line?.condition);
    if (![odds.H, odds.L, point].every((value) => Number.isFinite(value) && value > 0) || odds.H <= 1 || odds.L <= 1) {
      return [];
    }
    return {
      id: `hkjc-${match.id}-${suffix}-${point}`,
      matchId: `hkjc-${match.id}`,
      homeTeam: match.homeTeam?.name_en || match.homeTeam?.name_ch,
      awayTeam: match.awayTeam?.name_en || match.awayTeam?.name_ch,
      homeTeamZh: match.homeTeam?.name_ch || undefined,
      awayTeamZh: match.awayTeam?.name_ch || undefined,
      commenceTime: match.kickOffTime,
      bookmaker: "HKJC",
      league: match.tournament?.name_en || match.tournament?.name_ch || undefined,
      leagueZh: match.tournament?.name_ch || undefined,
      line: point,
      overOdds: odds.H,
      underOdds: odds.L,
    };
  });
}

async function fetchHistoricMatches() {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 7);
  return paginateHistoricMatches(async (startIndex, endIndex) => {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Referer: "https://bet.hkjc.com/en/football/results" },
        body: JSON.stringify({
          operationName: "matchResults",
          query: historicQuery,
          variables: {
            startDate: formatQueryDate(start),
            endDate: formatQueryDate(end),
            startIndex,
            endIndex,
            teamId: null,
          },
        }),
      });
      const payload = await response.json();
      if (!response.ok || payload.errors) return [];
      return payload.data?.matches ?? [];
    } catch {
      return [];
    }
  });
}

async function paginateHistoricMatches(fetchPage, pageSize = 20, maxPages = 50) {
  const matches = new Map();
  for (let page = 0; page < maxPages; page += 1) {
    const rows = await fetchPage(page * pageSize + 1, (page + 1) * pageSize);
    let added = 0;
    for (const row of Array.isArray(rows) ? rows : []) {
      if (row?.id && !matches.has(row.id)) {
        matches.set(row.id, row);
        added += 1;
      }
    }
    if (!Array.isArray(rows) || rows.length < pageSize || added === 0) break;
  }
  return [...matches.values()];
}

function finalHistoricResult(match) {
  const results = Array.isArray(match?.results) ? match.results : [];
  return results.find((result) => Number(result.stageId) === 5 && Number(result.resultType) === 1)
    ?? results.find((result) => Number(result.stageId) === 5)
    ?? null;
}

function parseHistoricResultRecords(matches) {
  return (Array.isArray(matches) ? matches : []).flatMap((match) => {
    const finalResult = finalHistoricResult(match);
    if (!finalResult || !Number.isFinite(Number(finalResult.homeResult)) || !Number.isFinite(Number(finalResult.awayResult)) || Number(finalResult.homeResult) < 0 || Number(finalResult.awayResult) < 0) {
      return [];
    }
    const base = {
      matchId: `hkjc-${match.id}`,
      homeTeam: match.homeTeam?.name_en || match.homeTeam?.name_ch,
      awayTeam: match.awayTeam?.name_en || match.awayTeam?.name_ch,
      commenceTime: match.kickOffTime,
      score: `${finalResult.homeResult}-${finalResult.awayResult}`,
      prediction: "未有賽前快照",
      hit: null,
    };
    const totalGoals = Number(finalResult.homeResult) + Number(finalResult.awayResult);
    const rows = [
      { ...base, id: `${base.matchId}-historic-had`, market: "主客和", actual: actualHad(Number(finalResult.homeResult), Number(finalResult.awayResult)) },
      { ...base, id: `${base.matchId}-historic-hdc`, market: "亞洲讓球", actual: base.score },
    ];
    if (Number.isFinite(Number(finalResult.ttlCornerResult)) && Number(finalResult.ttlCornerResult) >= 0) {
      rows.push({ ...base, id: `${base.matchId}-historic-corners`, market: "角球", actual: `${finalResult.ttlCornerResult} 角球` });
    }
    rows.push({ ...base, id: `${base.matchId}-historic-hil`, market: "大細波", actual: `${totalGoals} 球` });
    return rows;
  });
}

function utcDay(now) {
  return new Date(now).toISOString().slice(0, 10);
}

function rollApiFootballDay(state, now) {
  const day = utcDay(now);
  const next = {
    ...state,
    utcDay: day,
    calls: state.utcDay === day ? Number(state.calls ?? 0) : 0,
    resultCalls: state.utcDay === day ? Number(state.resultCalls ?? 0) : 0,
    quotaExhausted: state.utcDay === day ? Boolean(state.quotaExhausted) : false,
    fixtureIds: state.fixtureIds ?? {},
    fixtureDates: state.fixtureDates ?? {},
    oddsAttempts: state.oddsAttempts ?? {},
    resultAttempts: state.resultAttempts ?? {},
    cornerOdds: state.cornerOdds ?? [],
  };
  return next;
}

function apiFootballAllowed(state) {
  return !state.quotaExhausted && Number(state.calls ?? 0) < API_FOOTBALL_DAILY_LIMIT;
}

function resultDue(attempts, matchId, now, kickoff) {
  const attempt = attempts[matchId];
  const lastAttempt = Date.parse(attempt);
  return now - kickoff >= 150 * 60_000
    && (typeof attempt === "string" && /^\d{4}-\d{2}-\d{2}$/.test(attempt)
      || !Number.isFinite(lastAttempt)
      || now - lastAttempt >= 12 * 60 * 60_000);
}

function oddsDue(attempts, matchId, now) {
  return !attempts[matchId] || now - Date.parse(attempts[matchId]) >= 10 * 60_000;
}

async function ensureApiFootballFixtureIds(matches, apiKey, state, now) {
  const missing = matches.filter((match) => !state.fixtureIds[`hkjc-${match.id}`]);
  for (const date of new Set(missing.map((match) => match.kickOffTime?.slice(0, 10)).filter(Boolean))) {
    if (!apiFootballAllowed(state) || state.fixtureDates[date] === utcDay(now)) continue;
    const payload = await fetchApiFootball("fixtures", { date, timezone: "Asia/Hong_Kong" }, apiKey, state);
    state.fixtureDates[date] = utcDay(now);
    for (const match of missing.filter((item) => item.kickOffTime?.startsWith(date))) {
      const fixture = matchApiFootballFixture(match, payload.response ?? []);
      if (fixture?.fixture?.id) state.fixtureIds[`hkjc-${match.id}`] = fixture.fixture.id;
    }
  }
}

async function fetchApiFootballCornerOdds(matches, snapshots, state, now = Date.now()) {
  const apiKey = process.env.API_FOOTBALL_KEY;
  if (!apiKey) return [];
  const snapshotted = new Set(snapshots.filter((row) => row?.market === "角球").map((row) => row.matchId));
  const cached = new Set((state.cornerOdds ?? []).map((row) => row.matchId));
  const candidates = (Array.isArray(matches) ? matches : []).filter((match) => {
    const matchId = `hkjc-${match?.id}`;
    const delta = Date.parse(match?.kickOffTime) - now;
    return delta > 0 && delta <= 30 * 60_000
      && match?.foPools?.some((pool) => pool?.oddsType === "CHL")
      && !snapshotted.has(matchId)
      && !cached.has(matchId)
      && oddsDue(state.oddsAttempts, matchId, now);
  });
  if (candidates.length === 0 || !apiFootballAllowed(state)) return [];

  try {
    await ensureApiFootballFixtureIds(candidates, apiKey, state, now);
    const rows = [];
    for (const match of candidates) {
      const matchId = `hkjc-${match.id}`;
      if (!apiFootballAllowed(state)) break;
      state.oddsAttempts[matchId] = new Date(now).toISOString();
      const fixtureId = state.fixtureIds[matchId];
      if (!fixtureId) continue;
      rows.push(...parseApiFootballCornerOdds(await fetchApiFootball("odds", { fixture: fixtureId }, apiKey, state), match));
    }
    const byId = new Map((state.cornerOdds ?? []).map((row) => [row.id, row]));
    for (const row of rows) byId.set(row.id, row);
    state.cornerOdds = [...byId.values()];
    return rows;
  } catch (error) {
    console.warn(`[hkjc-import] API-Football corner odds skipped: ${error instanceof Error ? error.message : error}`);
    return [];
  }
}

function parseApiFootballCornerOdds(payload, match) {
  return (Array.isArray(payload?.response) ? payload.response : []).flatMap((event) =>
    (Array.isArray(event?.bookmakers) ? event.bookmakers : []).flatMap((bookmaker) => {
      const market = (Array.isArray(bookmaker?.bets) ? bookmaker.bets : []).find((bet) => bet?.name === "Corners Over Under");
      if (!market || !Array.isArray(market.values)) return [];
      return market.values.flatMap((outcome) => {
        const matchOver = /^Over ([0-9]+(?:\.[0-9]+)?)$/.exec(outcome?.value ?? "");
        if (!matchOver) return [];
        const line = Number(matchOver[1]);
        const overOdds = Number(outcome?.odd);
        const underOdds = Number(market.values.find((value) => value?.value === `Under ${line}`)?.odd);
        if (!Number.isFinite(line) || !Number.isFinite(overOdds) || !Number.isFinite(underOdds) || overOdds <= 1 || underOdds <= 1) return [];
        return [{
          id: `${match.id}-api-football-${bookmaker.id ?? bookmaker.name}-${line}`,
          matchId: `hkjc-${match.id}`,
          homeTeam: match.homeTeam?.name_en || match.homeTeam?.name_ch,
          awayTeam: match.awayTeam?.name_en || match.awayTeam?.name_ch,
          commenceTime: match.kickOffTime,
          bookmaker: bookmaker.name,
          line,
          overOdds,
          underOdds,
        }];
      });
    }));
}

async function fetchApiFootballCornerResults(historicMatches, snapshots, existingResults, state, now = Date.now()) {
  const apiKey = process.env.API_FOOTBALL_KEY;
  if (!apiKey) return [];
  const wanted = new Set(snapshots.filter((row) => row?.market === "角球").map((row) => row.matchId));
  const complete = new Set(existingResults.filter((row) => row?.market === "角球").map((row) => row.matchId));
  const candidates = historicMatches
    .filter((match) => {
      const matchId = `hkjc-${match.id}`;
      return wanted.has(matchId)
        && !complete.has(matchId)
        && resultDue(state.resultAttempts, matchId, now, Date.parse(match.kickOffTime));
    })
    .sort((left, right) => Date.parse(left.kickOffTime) - Date.parse(right.kickOffTime));
  if (candidates.length === 0 || !apiFootballAllowed(state)) return [];

  try {
    await ensureApiFootballFixtureIds(candidates, apiKey, state, now);
    const rows = [];
    for (const match of candidates) {
      if (!apiFootballAllowed(state) || state.resultCalls >= API_FOOTBALL_RESULT_LIMIT) break;
      const matchId = `hkjc-${match.id}`;
      state.resultAttempts[matchId] = new Date(now).toISOString();
      const fixtureId = state.fixtureIds[matchId];
      if (!fixtureId) continue;
      state.resultCalls += 1;
      const totalCorners = apiFootballCornerTotal(await fetchApiFootball("fixtures/statistics", { fixture: fixtureId }, apiKey, state));
      if (totalCorners === null) continue;
      const finalResult = finalHistoricResult(match);
      if (!finalResult) continue;
      rows.push({
        id: `${matchId}-historic-corners`,
        matchId,
        homeTeam: match.homeTeam?.name_en || match.homeTeam?.name_ch,
        awayTeam: match.awayTeam?.name_en || match.awayTeam?.name_ch,
        commenceTime: match.kickOffTime,
        score: `${finalResult.homeResult}-${finalResult.awayResult}`,
        prediction: "未有賽前快照",
        hit: null,
        market: "角球",
        actual: `${totalCorners} 角球`,
        source: "API-Football",
      });
    }
    return rows;
  } catch (error) {
    console.warn(`[hkjc-import] API-Football corner fallback skipped: ${error instanceof Error ? error.message : error}`);
    return [];
  }
}

async function fetchApiFootball(resource, params, apiKey, state) {
  if (!apiFootballAllowed(state)) throw new Error("API_FOOTBALL_BUDGET");
  const url = new URL(`${apiFootballEndpoint}/${resource}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  state.calls += 1;
  const response = await fetch(url, { headers: { "x-apisports-key": apiKey } });
  const payload = await response.json();
  const errors = Array.isArray(payload.errors) ? payload.errors : Object.values(payload.errors ?? {});
  const hasErrors = errors.length > 0;
  if (errors.some((error) => /request limit/i.test(String(error)))) state.quotaExhausted = true;
  if (!response.ok || hasErrors) throw new Error(state.quotaExhausted ? "API_FOOTBALL_QUOTA" : `API-Football ${response.status}`);
  return payload;
}

function matchApiFootballFixture(match, fixtures) {
  const kickoff = Date.parse(match.kickOffTime);
  return fixtures.find((fixture) =>
    Math.abs(Date.parse(fixture?.fixture?.date) - kickoff) <= 10 * 60 * 1000
    && teamNamesMatch(match.homeTeam?.name_en, fixture?.teams?.home?.name)
    && teamNamesMatch(match.awayTeam?.name_en, fixture?.teams?.away?.name));
}

function teamNamesMatch(left, right) {
  const a = normalizeTeamName(left);
  const b = normalizeTeamName(right);
  return Boolean(a && b && (a === b || a.includes(b) || b.includes(a)));
}

function normalizeTeamName(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/hyundai/g, "hd")
    .replace(/united/g, "utd")
    .replace(/(?:footballclub|fc|afc|fa|u23|ii|b)$/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function apiFootballCornerTotal(payload) {
  const values = (Array.isArray(payload?.response) ? payload.response : []).map((team) =>
    team?.statistics?.find((stat) => stat?.type === "Corner Kicks")?.value);
  if (values.length !== 2 || values.some((value) => value === null || value === undefined || !Number.isFinite(Number(value)))) return null;
  return values.reduce((sum, value) => sum + Number(value), 0);
}

function parseCornerResultOverrides(overrides, results) {
  return (Array.isArray(overrides) ? overrides : []).flatMap((override) => {
    const total = Number(override?.totalCorners);
    const base = (Array.isArray(results) ? results : []).find((row) => row?.matchId === override?.matchId);
    if (!base || !Number.isInteger(total) || total < 0
      || typeof override?.sourceUrl !== "string" || !override.sourceUrl.startsWith("https://www.fotmob.com/")
      || !Number.isFinite(Date.parse(override?.verifiedAt))) return [];
    return [{
      id: `${override.matchId}-manual-corners`, matchId: override.matchId,
      homeTeam: base.homeTeam, awayTeam: base.awayTeam, commenceTime: base.commenceTime, score: base.score,
      prediction: "未有賽前快照", hit: null, market: "角球", actual: `${total} 角球`,
      source: "manual:FOTMOB", sourceUrl: override.sourceUrl, verifiedAt: override.verifiedAt,
    }];
  });
}

function actualHad(homeScore, awayScore) {
  return homeScore > awayScore ? "主勝" : homeScore === awayScore ? "和局" : "客勝";
}

function formatQueryDate(date) {
  return date.toISOString().slice(0, 10);
}

function parseResultRecords(matches) {
  return (Array.isArray(matches) ? matches : []).flatMap((match) => {
    const result = match.runningResultExtra ?? match.runningResult;
    if (!isFinalMatch(match.status) || !result || !Number.isFinite(Number(result.homeScore)) || !Number.isFinite(Number(result.awayScore))) {
      return [];
    }
    const base = {
      matchId: `hkjc-${match.id}`,
      homeTeam: match.homeTeam?.name_en || match.homeTeam?.name_ch,
      awayTeam: match.awayTeam?.name_en || match.awayTeam?.name_ch,
      commenceTime: match.kickOffTime,
      score: `${result.homeScore}-${result.awayScore}`,
    };
    const totalGoals = Number(result.homeScore) + Number(result.awayScore);
    const totalCorners = Number(result.corner ?? Number(result.homeCorner) + Number(result.awayCorner));
    return [
      parseHadResult(base, match.foPools, Number(result.homeScore), Number(result.awayScore)),
      { ...base, id: `${base.matchId}-HDC-result`, market: "亞洲讓球", actual: base.score, prediction: "未有賽前快照", hit: null },
      parseHighLowResult(base, match.foPools, "HIL", "大細波", totalGoals),
      parseHighLowResult(base, match.foPools, "CHL", "角球", totalCorners),
    ].filter(Boolean);
  });
}

function isFinalMatch(status) {
  return ["FULLTIME", "RESULT", "RESULTREADY", "CLOSED", "FINISHED"].includes(status);
}

function parseHadResult(base, pools, homeScore, awayScore) {
  const pool = pools?.find((item) => item?.oddsType === "HAD");
  const odds = Object.fromEntries((pool?.lines?.[0]?.combinations ?? []).map((comb) => [comb?.str, Number(comb?.currentOdds)]));
  if (![odds.H, odds.D, odds.A].every((value) => Number.isFinite(value) && value > 1)) return null;
  const prediction = odds.H <= odds.D && odds.H <= odds.A ? "主勝" : odds.D <= odds.A ? "和" : "客勝";
  const actual = homeScore > awayScore ? "主勝" : homeScore === awayScore ? "和" : "客勝";
  return { ...base, id: `${base.matchId}-had-result`, market: "主客和", prediction, actual, hit: prediction === actual };
}

function parseHighLowResult(base, pools, oddsType, market, total) {
  const pool = pools?.find((item) => item?.oddsType === oddsType);
  const line = pool?.lines?.find((item) => item?.main !== false) ?? pool?.lines?.[0];
  const odds = Object.fromEntries((line?.combinations ?? []).map((comb) => [comb?.str, Number(comb?.currentOdds)]));
  const point = parseLine(line?.condition);
  if (![odds.H, odds.L, point, total].every(Number.isFinite) || odds.H <= 1 || odds.L <= 1) return null;
  const prediction = odds.H <= odds.L ? "大" : "細";
  const actual = total > point ? "大" : total < point ? "細" : "走水";
  return { ...base, id: `${base.matchId}-${oddsType}-result`, market, line: point, prediction, actual, hit: prediction === actual };
}

function parseLine(value) {
  if (typeof value !== "string") {
    return Number(value);
  }
  const parts = value.split("/").map(Number).filter(Number.isFinite);
  if (parts.length === 0) {
    return Number.NaN;
  }
  return parts.reduce((sum, part) => sum + part, 0) / parts.length;
}

function mergeResultArchive(existing, incoming) {
  const byStableKey = new Map();
  for (const row of [...existing, ...incoming]) {
    const key = row?.matchId && row?.market ? `${row.matchId}|${row.market}` : row?.id;
    if (key) byStableKey.set(key, row);
  }
  return [...byStableKey.values()];
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

async function readJsonl(file) {
  try {
    const text = await readFile(file, "utf8");
    return text.trim() ? text.trim().split(/\r?\n/).map((line) => JSON.parse(line)) : [];
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

function assert(value, message) {
  if (!value) {
    throw new Error(message);
  }
}
