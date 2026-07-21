// Post-kickoff gate for buy CTAs. Market cards keep rendering from the last
// fresh odds for a while after kickoff; without this gate they still show a
// "買" call-to-action even though pre-match snapshots are deliberately not
// recorded post-kickoff (see toSnapshot in App.tsx and shared/snapshot-policy).
export const POST_KICKOFF_LABEL = "已開賽";

export function isPostKickoff(commenceTime: string | undefined, now: number = Date.now()): boolean {
  const kickoff = Date.parse(commenceTime ?? "");
  return Number.isFinite(kickoff) && kickoff <= now;
}

export function gatePickLabel(pickLabel: string, commenceTime: string, now: number = Date.now()): string {
  return isPostKickoff(commenceTime, now) ? POST_KICKOFF_LABEL : pickLabel;
}
