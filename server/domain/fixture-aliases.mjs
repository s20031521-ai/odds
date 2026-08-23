// Canonical fixture identity registry (MODEL-VALIDITY-IMPLEMENTATION-REPORT
// 2026-08-23, Workstream B). Team and league aliases are promoted from inline
// program constants to one explicit, testable registry so HDC and HKJC rows
// for the same match resolve to the same fixtureId.
//
// Rules:
// - Aliases are APPROVED, exact, full-name equivalences only. No fuzzy rules
//   beyond the `Utd` → `United` suffix, which is itself an approved alias.
// - Gender markers ("women", "女子", etc.) are never stripped, so men's and
//   women's teams can never merge.
// - Home/away direction and the ±10 minute kickoff window stay enforced by
//   the caller (fixture-repository); this module only canonicalizes names.
// - Unknown names pass through unchanged (fail-closed: no merging).

/** Normalize any display name into a comparison key. */
export function normalizeNameKey(value) {
  if (typeof value !== "string") return "";
  return value.normalize("NFKC").trim().toLocaleLowerCase("en")
    .replace(/[\p{P}\p{S}\s]+/gu, "");
}

// League aliases: normalized variant → canonical league key.
// Covers the splits reproduced in production (K League 1 / Korean Division 1,
// J League / Japanese Division 1) plus the previously approved South American
// mappings that lived inline in fixture-repository.
const LEAGUE_ALIASES = new Map(Object.entries({
  "kleague1": "korea-division-1",
  "koreandivision1": "korea-division-1",
  "jleague": "japan-division-1",
  "j1league": "japan-division-1",
  "japanesedivision1": "japan-division-1",
  "brazilsériea": "brazil-division-1",
  "braziliandivision1": "brazil-division-1",
  "brazilsérieb": "brazil-division-2",
  "braziliandivision2": "brazil-division-2",
  "primeradivisiónargentina": "argentina-division-1",
  "argentinedivision1": "argentina-division-1",
  "primeradivisiónchile": "chile-division-1",
  "chileandivision1": "chile-division-1",
}));

// Team aliases: normalized variant → canonical team key.
// Only production-confirmed or explicitly approved equivalences.
const TEAM_ALIASES = new Map(Object.entries({
  // J League: HKJC short forms vs HDC official names.
  "fcmachidazelvia": "machidazelvia",
  "machidazelvia": "machidazelvia",
  "urawareddiamonds": "urawareds",
  "urawareds": "urawareds",
  // K League: HKJC "Incheon Utd" vs HDC "Incheon United".
  "incheonutd": "incheonunited",
  "incheonunited": "incheonunited",
}));

/** Canonical league key for cross-provider comparison; "" for non-strings. */
export function canonicalLeagueKey(value) {
  const normalized = normalizeNameKey(value);
  return LEAGUE_ALIASES.get(normalized) ?? normalized;
}

/** Canonical team key for cross-provider comparison; "" for non-strings. */
export function canonicalTeamKey(value) {
  const normalized = normalizeNameKey(value);
  if (!normalized) return "";
  const alias = TEAM_ALIASES.get(normalized);
  if (alias) return alias;
  // Approved generic alias: trailing "Utd" ≡ "United" (e.g. "Incheon Utd").
  // Never strips anything else, so "Manchester" can never match
  // "Manchester United" and gender markers are preserved.
  if (normalized.endsWith("utd")) return `${normalized.slice(0, -3)}united`;
  return normalized;
}

/** League compatibility gate used by fixture candidate matching. */
export function leaguesCompatible(left, right) {
  return !left || !right || canonicalLeagueKey(left) === canonicalLeagueKey(right);
}
