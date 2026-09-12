import { describe, expect, it } from "vitest";

import { extractHeadings } from "./toc";

describe("extractHeadings", () => {
  it("extracts only ## and ### headings, with the right level and slug", () => {
    const markdown = [
      "# Title (not a TOC entry)",
      "Some intro text.",
      "## First Section",
      "Body text.",
      "### A Subsection",
      "#### Too deep (not a TOC entry)",
      "## Second Section",
    ].join("\n");

    expect(extractHeadings(markdown)).toEqual([
      { level: 2, text: "First Section", slug: "first-section" },
      { level: 3, text: "A Subsection", slug: "a-subsection" },
      { level: 2, text: "Second Section", slug: "second-section" },
    ]);
  });

  it("returns an empty array when there are no ##/### headings", () => {
    expect(extractHeadings("# Just a title\n\nSome text, no subheadings.")).toEqual([]);
  });
});
