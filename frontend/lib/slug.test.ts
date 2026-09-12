import { describe, expect, it } from "vitest";

import { slugify } from "./slug";

describe("slugify", () => {
  it("lowercases and hyphenates a plain heading", () => {
    expect(slugify("Getting Started")).toBe("getting-started");
  });

  it("collapses runs of punctuation/whitespace into a single hyphen", () => {
    expect(slugify("Step 1: Setup & Config!!")).toBe("step-1-setup-config");
  });

  it("strips leading and trailing hyphens", () => {
    expect(slugify("  --Already Sluggy--  ")).toBe("already-sluggy");
  });

  it("returns an empty string for input with no alphanumeric characters", () => {
    expect(slugify("!!!")).toBe("");
  });
});
