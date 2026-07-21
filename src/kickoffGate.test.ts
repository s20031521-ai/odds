import { describe, expect, it } from "vitest";
import { gatePickLabel, isPostKickoff, POST_KICKOFF_LABEL } from "./kickoffGate";

const NOW = Date.parse("2026-07-22T01:30:00+08:00");
const PAST = "2026-07-22T01:00:00+08:00";
const FUTURE = "2026-07-23T01:00:00+08:00";

describe("isPostKickoff", () => {
  it("returns true when kickoff time has passed", () => {
    expect(isPostKickoff(PAST, NOW)).toBe(true);
  });

  it("returns true exactly at kickoff time", () => {
    expect(isPostKickoff(PAST, Date.parse(PAST))).toBe(true);
  });

  it("returns false when kickoff is in the future", () => {
    expect(isPostKickoff(FUTURE, NOW)).toBe(false);
  });

  it("returns false for unparseable kickoff times", () => {
    expect(isPostKickoff("", NOW)).toBe(false);
    expect(isPostKickoff("not-a-date", NOW)).toBe(false);
  });
});

describe("gatePickLabel", () => {
  it("replaces a buy label with the post-kickoff label after kickoff", () => {
    expect(gatePickLabel("買細", PAST, NOW)).toBe(POST_KICKOFF_LABEL);
    expect(gatePickLabel("買 主 -0.5", PAST, NOW)).toBe(POST_KICKOFF_LABEL);
    expect(gatePickLabel("買大角", PAST, NOW)).toBe(POST_KICKOFF_LABEL);
  });

  it("keeps buy labels before kickoff", () => {
    expect(gatePickLabel("買細", FUTURE, NOW)).toBe("買細");
  });

  it("keeps neutral labels unchanged even after kickoff", () => {
    expect(gatePickLabel("唔買", PAST, NOW)).toBe("唔買");
    expect(gatePickLabel("資料不足，唔買", PAST, NOW)).toBe("資料不足，唔買");
  });

  it("uses the post-kickoff label text 已開賽", () => {
    expect(POST_KICKOFF_LABEL).toBe("已開賽");
  });
});
