import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { initials, TeamLogo, type TeamLogoMap } from "./TeamLogo";

const logos: TeamLogoMap = {
  Arsenal: { id: 42, logo: "/team-logos/42.png" },
};

describe("TeamLogo", () => {
  it("renders a 24px local img when the team is mapped", () => {
    const markup = renderToStaticMarkup(<TeamLogo teamName="Arsenal" logos={logos} />);

    expect(markup).toContain("<img");
    expect(markup).toContain('src="/team-logos/42.png"');
    expect(markup).toContain('width="24"');
    expect(markup).toContain('height="24"');
    expect(markup).toContain('loading="lazy"');
    expect(markup).toContain('alt=""');
    expect(markup).not.toContain("team-logo--badge");
    expect(markup).not.toContain("media.api-football.com");
  });

  it("renders an initials badge when the team is not mapped", () => {
    const markup = renderToStaticMarkup(<TeamLogo teamName="Manchester United" logos={logos} />);

    expect(markup).not.toContain("<img");
    expect(markup).toContain("team-logo--badge");
    expect(markup).toContain(">MU</span>");
  });

  it("is deterministic: same team renders identical badge markup", () => {
    const first = renderToStaticMarkup(<TeamLogo teamName="Chelsea" logos={{}} />);
    const second = renderToStaticMarkup(<TeamLogo teamName="Chelsea" logos={{}} />);

    expect(first).toBe(second);
  });
});

describe("initials", () => {
  it("uses the first letter of the first two words", () => {
    expect(initials("Manchester United")).toBe("MU");
  });

  it("uses the first two letters for single-word teams", () => {
    expect(initials("Arsenal")).toBe("AR");
  });

  it("handles blank input safely", () => {
    expect(initials("   ")).toBe("?");
  });
});
