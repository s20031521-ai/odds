import type { Fixture } from "./odds";

export type FixtureDateGroup = {
  date: string;
  fixtures: Fixture[];
};

export function groupFixturesByDate(fixtures: Fixture[]): FixtureDateGroup[] {
  const groups = new Map<string, Fixture[]>();

  for (const fixture of fixtures) {
    const date = fixtureDateKey(fixture.commenceTime);
    groups.set(date, [...(groups.get(date) ?? []), fixture]);
  }

  return [...groups.entries()]
    .map(([date, groupFixtures]) => ({ date, fixtures: groupFixtures }))
    .sort((a, b) => sortableDate(a.date) - sortableDate(b.date));
}

export function fixtureDateKey(value: string): string {
  if (!value) return "未設定日期";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未設定日期";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: "year" | "month" | "day") => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function formatFixtureDateHeading(value: string): string {
  return value === "未設定日期" ? value : value.replace(/-/g, "/");
}

function sortableDate(value: string): number {
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? Number.MAX_SAFE_INTEGER : time;
}
