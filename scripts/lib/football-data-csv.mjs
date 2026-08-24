// Parser for football-data.co.uk match CSVs (mmz4281 format).
// Pure functions only — no I/O — so tests and self-test never touch network or DB.
//
// Odds timing (football-data.co.uk convention since 2019/20): columns without
// a "C" suffix (PSH, P>2.5, PAHH, AvgH, ...) are the pre-closing set, collected
// after market opening; columns with the "C" suffix (PSCH, PC>2.5, PCAHH,
// AvgCH, ...) are the true closing odds. The legacy "closing*" fields below
// keep their original pre-closing (PS*/B365*) semantics so existing harnesses
// stay byte-identical; the Phase 1 blend backtest uses the pinClose*/avgOpen*/
// avgClose* fields instead.
//
// Legacy "closing*" preference: Pinnacle (PS*) first, Bet365 (B365*) as fallback.
// Totals columns ("B365>2.5" etc.) imply the 2.5 goal line; Asian handicap
// uses the AHh column (home-team handicap) with PAH*/B365AH* prices.

const H2H_COLUMNS = {
  closingHomeOdds: ["PSH", "B365H"],
  closingDrawOdds: ["PSD", "B365D"],
  closingAwayOdds: ["PSA", "B365A"],
};
const TOTALS_COLUMNS = {
  closingOverOdds: ["P>2.5", "B365>2.5"],
  closingUnderOdds: ["P<2.5", "B365<2.5"],
};
const HANDICAP_COLUMNS = {
  closingHandicapHomeOdds: ["PAHH", "B365AHH"],
  closingHandicapAwayOdds: ["PAHA", "B365AHA"],
};

export function inferSeason(matchDateIso) {
  const year = Number(matchDateIso.slice(0, 4));
  const month = Number(matchDateIso.slice(5, 7));
  const startYear = month >= 7 ? year : year - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

export function parseFootballDataCsv(text, { leagueCode } = {}) {
  if (typeof text !== "string" || text.trim() === "") return [];
  const records = tokenizeCsv(text.replace(/^﻿/, ""));
  if (records.length < 2) return [];
  const header = records[0].map((field) => field.trim());
  const columnIndex = new Map(header.map((name, index) => [name, index]));

  const rows = [];
  for (const fields of records.slice(1)) {
    const row = mapRecord(fields, columnIndex, leagueCode);
    if (row) rows.push(row);
  }
  return rows;
}

function mapRecord(fields, columnIndex, fallbackLeagueCode) {
  const get = (name) => {
    const index = columnIndex.get(name);
    return index === undefined ? "" : (fields[index] ?? "").trim();
  };
  const homeGoals = parseInteger(get("FTHG"));
  const awayGoals = parseInteger(get("FTAG"));
  const matchDate = parseMatchDate(get("Date"));
  const homeTeam = get("HomeTeam");
  const awayTeam = get("AwayTeam");
  if (homeGoals === null || awayGoals === null || !matchDate || !homeTeam || !awayTeam) return null;

  const row = {
    leagueCode: get("Div") || fallbackLeagueCode || null,
    season: inferSeason(matchDate),
    matchDate,
    homeTeam,
    awayTeam,
    homeGoals,
    awayGoals,
  };
  if (!row.leagueCode) return null;

  // --- Phase 2 additive fields: corner counts (HC/AC) + shots-on-target ---
  // Nullable: older CSV variants may lack the columns; the corners engine
  // skips NULL rows when fitting.
  row.homeCorners = parseInteger(get("HC"));
  row.awayCorners = parseInteger(get("AC"));
  row.homeShotsOnTarget = parseInteger(get("HST"));
  row.awayShotsOnTarget = parseInteger(get("AST"));

  for (const [target, sources] of Object.entries(H2H_COLUMNS)) {
    row[target] = firstValidOdds(get, sources);
  }
  for (const [target, sources] of Object.entries(TOTALS_COLUMNS)) {
    row[target] = firstValidOdds(get, sources);
  }
  row.closingTotalsLine = row.closingOverOdds !== null || row.closingUnderOdds !== null ? 2.5 : null;

  const handicapLine = parseNumeric(get("AHh"));
  const handicapHome = firstValidOdds(get, HANDICAP_COLUMNS.closingHandicapHomeOdds);
  const handicapAway = firstValidOdds(get, HANDICAP_COLUMNS.closingHandicapAwayOdds);
  row.closingHandicapLine = handicapLine !== null && (handicapHome !== null || handicapAway !== null) ? handicapLine : null;
  row.closingHandicapHomeOdds = row.closingHandicapLine !== null ? handicapHome : null;
  row.closingHandicapAwayOdds = row.closingHandicapLine !== null ? handicapAway : null;

  // --- Phase 1 additive fields: true closing odds and market-average prices ---
  // Pinnacle pre-closing (pure Pinnacle only — the legacy "closing*" fields
  // fall back to Bet365; the blend backtest anchors must not mix books).
  row.pinOpenHomeOdds = firstValidOdds(get, ["PSH"]);
  row.pinOpenDrawOdds = firstValidOdds(get, ["PSD"]);
  row.pinOpenAwayOdds = firstValidOdds(get, ["PSA"]);
  row.pinOpenOverOdds = firstValidOdds(get, ["P>2.5"]);
  row.pinOpenUnderOdds = firstValidOdds(get, ["P<2.5"]);
  const pinOpenAhHome = firstValidOdds(get, ["PAHH"]);
  const pinOpenAhAway = firstValidOdds(get, ["PAHA"]);
  row.pinOpenHandicapLine = handicapLine !== null && (pinOpenAhHome !== null || pinOpenAhAway !== null) ? handicapLine : null;
  row.pinOpenHandicapHomeOdds = row.pinOpenHandicapLine !== null ? pinOpenAhHome : null;
  row.pinOpenHandicapAwayOdds = row.pinOpenHandicapLine !== null ? pinOpenAhAway : null;
  // Pinnacle closing (C-suffix columns).
  row.pinCloseHomeOdds = firstValidOdds(get, ["PSCH"]);
  row.pinCloseDrawOdds = firstValidOdds(get, ["PSCD"]);
  row.pinCloseAwayOdds = firstValidOdds(get, ["PSCA"]);
  row.pinCloseOverOdds = firstValidOdds(get, ["PC>2.5"]);
  row.pinCloseUnderOdds = firstValidOdds(get, ["PC<2.5"]);
  const pinCloseAhHome = firstValidOdds(get, ["PCAHH"]);
  const pinCloseAhAway = firstValidOdds(get, ["PCAHA"]);
  const closeHandicapLine = parseNumeric(get("AHCh"));
  row.pinCloseHandicapLine = closeHandicapLine !== null && (pinCloseAhHome !== null || pinCloseAhAway !== null) ? closeHandicapLine : null;
  row.pinCloseHandicapHomeOdds = row.pinCloseHandicapLine !== null ? pinCloseAhHome : null;
  row.pinCloseHandicapAwayOdds = row.pinCloseHandicapLine !== null ? pinCloseAhAway : null;
  // Market-average pre-closing (Betbrain/Oddsportal average).
  row.avgOpenHomeOdds = firstValidOdds(get, ["AvgH"]);
  row.avgOpenDrawOdds = firstValidOdds(get, ["AvgD"]);
  row.avgOpenAwayOdds = firstValidOdds(get, ["AvgA"]);
  row.avgOpenOverOdds = firstValidOdds(get, ["Avg>2.5"]);
  row.avgOpenUnderOdds = firstValidOdds(get, ["Avg<2.5"]);
  row.avgOpenHandicapHomeOdds = firstValidOdds(get, ["AvgAHH"]);
  row.avgOpenHandicapAwayOdds = firstValidOdds(get, ["AvgAHA"]);
  // Market-average closing.
  row.avgCloseHomeOdds = firstValidOdds(get, ["AvgCH"]);
  row.avgCloseDrawOdds = firstValidOdds(get, ["AvgCD"]);
  row.avgCloseAwayOdds = firstValidOdds(get, ["AvgCA"]);
  row.avgCloseOverOdds = firstValidOdds(get, ["AvgC>2.5"]);
  row.avgCloseUnderOdds = firstValidOdds(get, ["AvgC<2.5"]);
  row.avgCloseHandicapHomeOdds = firstValidOdds(get, ["AvgCAHH"]);
  row.avgCloseHandicapAwayOdds = firstValidOdds(get, ["AvgCAHA"]);
  return row;
}

function firstValidOdds(get, sources) {
  for (const name of sources) {
    const value = parseNumeric(get(name));
    if (value !== null && value > 1) return value;
  }
  return null;
}

function parseInteger(value) {
  if (value === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function parseNumeric(value) {
  if (value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseMatchDate(value) {
  const match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  let year = Number(match[3]);
  if (year < 100) year += year >= 70 ? 1900 : 2000;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// Minimal RFC-4180 tokenizer: quoted fields, escaped quotes (""), CRLF tolerant.
function tokenizeCsv(text) {
  const records = [];
  let fields = [];
  let field = "";
  let inQuotes = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"' && field === "") {
      inQuotes = true;
    } else if (char === ",") {
      fields.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      fields.push(field);
      field = "";
      if (fields.some((value) => value !== "")) records.push(fields);
      fields = [];
    } else {
      field += char;
    }
  }
  fields.push(field);
  if (fields.some((value) => value !== "")) records.push(fields);
  return records;
}
