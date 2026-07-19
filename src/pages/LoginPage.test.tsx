// @ts-expect-error Vitest runs this file in Node; the app intentionally has no Node type dependency.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("LoginPage source contract", () => {
  const source = () => readFileSync(new URL("./LoginPage.tsx", import.meta.url), "utf8");

  it("uses a single-owner username and password form without persisting passwords", () => {
    const text = source();

    expect(text).toContain('autoComplete="username"');
    expect(text).toContain('autoComplete="current-password"');
    expect(text).toContain('type="password"');
    expect(text).toContain("setPassword(\"\")");
    expect(text).not.toMatch(/localStorage|sessionStorage/);
  });

  it("has pending, generic invalid-login, cooldown, and offline states", () => {
    const text = source();

    expect(text).toContain("pending");
    expect(text).toContain("用戶名或密碼不正確");
    expect(text).toContain("登入太多次");
    expect(text).toContain("暫時連唔到系統");
    expect(text).toContain('role="alert"');
  });
});
