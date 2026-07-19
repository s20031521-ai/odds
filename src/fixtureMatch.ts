export type FixtureLike = {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
  bookmaker?: string;
  homeTeamEn?: string;
  awayTeamEn?: string;
};

export function sameFixture(left: FixtureLike, right: FixtureLike): boolean {
  const leftTime = Date.parse(left.commenceTime);
  const rightTime = Date.parse(right.commenceTime);
  return Number.isFinite(leftTime) && Number.isFinite(rightTime)
    && Math.abs(leftTime - rightTime) <= 10 * 60 * 1000
    && teamNamesMatch(left.homeTeamEn ?? left.homeTeam, right.homeTeamEn ?? right.homeTeam)
    && teamNamesMatch(left.awayTeamEn ?? left.awayTeam, right.awayTeamEn ?? right.awayTeam);
}

export function groupByFixture<T extends FixtureLike>(entries: T[]): Map<string, T[]> {
  const groups: T[][] = [];
  for (const entry of entries) {
    const group = groups.find((items) => sameFixture(items[0], entry));
    if (group) group.push(entry);
    else groups.push([entry]);
  }
  return new Map(groups.map((items) => [items.find((entry) => entry.bookmaker === "HKJC")?.matchId ?? items[0].matchId, items]));
}

function teamNamesMatch(left: string, right: string): boolean {
  const a = normalizeTeam(left);
  const b = normalizeTeam(right);
  return Boolean(a.base && b.base) && a.base === b.base && a.gender === b.gender;
}

const clubSuffixTokens = new Set(["fc", "afc", "cf", "bk", "if", "sk"]);
const womenTokens = new Set(["women", "w", "ladies", "女足"]);

function normalizeTeam(value: string): { base: string; gender: "men" | "women" } {
  const tokens = (value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .match(/(?<![\p{L}\p{N}.])(?:[\p{L}]\.){1,2}[\p{L}](?![\p{L}\p{N}]|\.[\p{L}])|[\p{L}\p{N}]+/gu) ?? [])
    .map((token) => token.replace(/\./g, ""));
  const gender = tokens.some((token) => womenTokens.has(token)) ? "women" : "men";
  const base = tokens
    .filter((token) => !womenTokens.has(token) && !clubSuffixTokens.has(token))
    .join("");
  return { base, gender };
}
