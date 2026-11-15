import { describe, expect, it } from "vitest";

import { diffLines, withContext } from "./diff";

describe("diffLines", () => {
  it("marks identical text as unchanged", () => {
    expect(diffLines("a\nb", "a\nb")).toEqual([
      { type: "same", text: "a" },
      { type: "same", text: "b" },
    ]);
  });

  it("finds a changed line in the middle", () => {
    expect(diffLines("a\nb\nc", "a\nB\nc")).toEqual([
      { type: "same", text: "a" },
      { type: "removed", text: "b" },
      { type: "added", text: "B" },
      { type: "same", text: "c" },
    ]);
  });

  it("handles pure insertions and deletions", () => {
    expect(diffLines("a\nc", "a\nb\nc")).toEqual([
      { type: "same", text: "a" },
      { type: "added", text: "b" },
      { type: "same", text: "c" },
    ]);
    expect(diffLines("a\nb\nc", "a\nc")).toEqual([
      { type: "same", text: "a" },
      { type: "removed", text: "b" },
      { type: "same", text: "c" },
    ]);
  });

  it("treats empty text as no lines", () => {
    expect(diffLines("", "x")).toEqual([{ type: "added", text: "x" }]);
    expect(diffLines("x", "")).toEqual([{ type: "removed", text: "x" }]);
    expect(diffLines("", "")).toEqual([]);
  });

  it("keeps lines common to both sides even when moved around changes", () => {
    const result = diffLines("x\na\ny\nb", "a\nz\nb");
    expect(result.filter((line) => line.type === "same").map((line) => line.text)).toEqual(["a", "b"]);
    expect(result.filter((line) => line.type === "removed").map((line) => line.text)).toEqual(["x", "y"]);
    expect(result.filter((line) => line.type === "added").map((line) => line.text)).toEqual(["z"]);
  });
});

describe("withContext", () => {
  it("folds long unchanged runs into gaps", () => {
    const before = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n");
    const after = before.replace("line 10", "LINE 10");
    const folded = withContext(diffLines(before, after), 2);
    expect(folded[0]).toEqual({ type: "gap", count: 8 });
    expect(folded.at(-1)).toEqual({ type: "gap", count: 7 });
    expect(folded.filter((line) => line.type !== "gap")).toHaveLength(6);
  });

  it("returns nothing but a gap when there are no changes", () => {
    expect(withContext(diffLines("a\nb", "a\nb"))).toEqual([{ type: "gap", count: 2 }]);
  });
});
