import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Mascot } from "./Kawaii";

describe("Mascot", () => {
  it("renders local chiikawa corner image as decorative", () => {
    const html = renderToStaticMarkup(<Mascot pose="chiikawa-corner" />);
    expect(html).toContain('src="/chiikawa/mascot-chiikawa-corner.png"');
    expect(html).toContain('alt=""');
    expect(html).toContain("mascot--corner");
  });

  it("renders each pose with its own image", () => {
    expect(renderToStaticMarkup(<Mascot pose="chiikawa-empty" />)).toContain("mascot-chiikawa-empty.png");
    expect(renderToStaticMarkup(<Mascot pose="momonga-loading" />)).toContain("mascot-momonga-loading.png");
    expect(renderToStaticMarkup(<Mascot pose="login-duo" />)).toContain("mascot-login-duo.png");
  });

  it("renders momonga alert pose reusing the loading image", () => {
    const html = renderToStaticMarkup(<Mascot pose="momonga-alert" />);
    expect(html).toContain('src="/chiikawa/mascot-momonga-loading.png"');
    expect(html).toContain("mascot--alert");
    expect(html).toContain('alt=""');
  });
});

