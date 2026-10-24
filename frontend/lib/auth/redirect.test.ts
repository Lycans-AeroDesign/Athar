import { describe, expect, it } from "vitest";
import { safeRedirectPath } from "./redirect";

describe("safeRedirectPath", () => {
  it("defaults to root when null, undefined, or empty", () => {
    expect(safeRedirectPath(null)).toBe("/");
    expect(safeRedirectPath("")).toBe("/");
    expect(safeRedirectPath("   ")).toBe("/");
  });

  it("blocks open redirects and protocol-relative URLs", () => {
    expect(safeRedirectPath("https://evil.com")).toBe("/");
    expect(safeRedirectPath("http://evil.com")).toBe("/");
    expect(safeRedirectPath("//evil.com")).toBe("/");
    expect(safeRedirectPath("/\\evil.com")).toBe("/");
    expect(safeRedirectPath("javascript:alert(1)")).toBe("/");
  });

  it("preserves valid same-site paths and query parameters", () => {
    expect(safeRedirectPath("/training/courses/123")).toBe("/training/courses/123");
    expect(safeRedirectPath("/training/courses?tab=lessons")).toBe("/training/courses?tab=lessons");
    expect(safeRedirectPath("/sops/new?project=foo-bar")).toBe("/sops/new?project=foo-bar");
  });

  it("strips locale prefixes so next-intl does not duplicate them", () => {
    expect(safeRedirectPath("/en/training/courses/123")).toBe("/training/courses/123");
    expect(safeRedirectPath("/ar/sops/new")).toBe("/sops/new");
    expect(safeRedirectPath("/en")).toBe("/");
    expect(safeRedirectPath("/ar/")).toBe("/");
  });

  it("prevents redirect loops back to auth pages", () => {
    expect(safeRedirectPath("/login")).toBe("/");
    expect(safeRedirectPath("/en/login")).toBe("/");
    expect(safeRedirectPath("/login?next=/something")).toBe("/");
    expect(safeRedirectPath("/register")).toBe("/");
    expect(safeRedirectPath("/en/register")).toBe("/");
  });
});
