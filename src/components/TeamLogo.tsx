export type TeamLogoEntry = { id: number; logo: string; needsReview?: boolean };
export type TeamLogoMap = Record<string, TeamLogoEntry>;

const BADGE_COLORS = [
  "var(--color-primary)",
  "var(--color-positive)",
  "var(--color-warning)",
  "var(--color-muted)",
] as const;

export function TeamLogo(props: { teamName: string; logos: TeamLogoMap }): React.ReactElement {
  const entry = props.logos[props.teamName];
  if (entry?.logo) {
    return <img alt="" className="team-logo" height={24} loading="lazy" src={entry.logo} width={24} />;
  }
  return (
    <span aria-hidden="true" className="team-logo team-logo--badge" style={{ background: badgeColor(props.teamName) }}>
      {initials(props.teamName)}
    </span>
  );
}

export function initials(teamName: string): string {
  const words = teamName.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words[1][0]}`.toUpperCase();
}

function badgeColor(teamName: string): string {
  let hash = 0;
  for (const char of teamName) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
  return BADGE_COLORS[hash % BADGE_COLORS.length];
}
