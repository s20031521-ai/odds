export const BUY_EDGE_THRESHOLD = 0.03 as const;

export type BuyMarket = "主客和" | "大細波" | "角球" | "亞洲讓球";

export type BuyPick = {
  market: BuyMarket;
  selection: string;
  line?: number;
  odds: number;
  chance: number;
  edge: number;
  bookmaker: string;
};

export type BuyCandidate = BuyPick & {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
};

export type BuyOpportunity = {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
  primary: BuyPick;
  alternatives: BuyPick[];
};

const BUY_MARKETS: ReadonlySet<string> = new Set(["主客和", "大細波", "角球", "亞洲讓球"]);

export function selectBuyOpportunities(
  candidates: BuyCandidate[],
  options: { now: number; edgeThreshold: typeof BUY_EDGE_THRESHOLD; dataFresh: boolean },
): BuyOpportunity[] {
  if (!options.dataFresh) return [];

  const grouped = new Map<string, { candidate: BuyCandidate; picks: BuyPick[] }>();

  for (const candidate of candidates) {
    if (!isValidCandidate(candidate, options.now, options.edgeThreshold)) continue;

    const group = grouped.get(candidate.matchId);
    const pick = toPick(candidate);
    if (group) {
      group.picks.push(pick);
    } else {
      grouped.set(candidate.matchId, { candidate, picks: [pick] });
    }
  }

  return [...grouped.values()]
    .map(({ candidate, picks }) => {
      const [primary, ...alternatives] = picks.sort(comparePicks);
      return {
        matchId: candidate.matchId,
        homeTeam: candidate.homeTeam,
        awayTeam: candidate.awayTeam,
        commenceTime: candidate.commenceTime,
        primary,
        alternatives,
      };
    })
    .sort((left, right) =>
      right.primary.edge - left.primary.edge
      || Date.parse(left.commenceTime) - Date.parse(right.commenceTime)
      || compareText(left.matchId, right.matchId));
}

function isValidCandidate(
  candidate: BuyCandidate,
  now: number,
  edgeThreshold: typeof BUY_EDGE_THRESHOLD,
): boolean {
  if (!candidate || typeof candidate !== "object") return false;

  const kickoff = typeof candidate.commenceTime === "string"
    ? Date.parse(candidate.commenceTime)
    : Number.NaN;

  return isNonBlank(candidate.matchId)
    && isNonBlank(candidate.homeTeam)
    && isNonBlank(candidate.awayTeam)
    && isNonBlank(candidate.selection)
    && isNonBlank(candidate.bookmaker)
    && BUY_MARKETS.has(candidate.market)
    && Number.isFinite(kickoff)
    && kickoff > now
    && Number.isFinite(candidate.chance)
    && candidate.chance > 0
    && candidate.chance <= 1
    && Number.isFinite(candidate.edge)
    && candidate.edge >= edgeThreshold
    && Number.isFinite(candidate.odds)
    && candidate.odds > 1
    && (candidate.line === undefined
      || (typeof candidate.line === "number" && Number.isFinite(candidate.line)));
}

function isNonBlank(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function toPick(candidate: BuyCandidate): BuyPick {
  const pick: BuyPick = {
    market: candidate.market,
    selection: candidate.selection,
    odds: candidate.odds,
    chance: candidate.chance,
    edge: candidate.edge,
    bookmaker: candidate.bookmaker,
  };
  if (candidate.line !== undefined) pick.line = candidate.line;
  return pick;
}

function comparePicks(left: BuyPick, right: BuyPick): number {
  return right.edge - left.edge
    || compareText(left.market, right.market)
    || compareLines(left.line, right.line)
    || compareText(left.selection, right.selection)
    || compareText(left.bookmaker, right.bookmaker);
}

function compareLines(left: number | undefined, right: number | undefined): number {
  if (left === undefined) return right === undefined ? 0 : 1;
  if (right === undefined) return -1;
  return left - right;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
