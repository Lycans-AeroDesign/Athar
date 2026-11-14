import { describe, expect, it } from "vitest";

import { parseMentionHref, toDisplay, toStorage } from "./mentions";

const MOTOR = "/components/3f2b1c4e-0000-4000-8000-000000000001";
const MOUNT = "/components/3f2b1c4e-0000-4000-8000-000000000002";
const ARTICLE = "/knowledge/articles/3f2b1c4e-0000-4000-8000-000000000003";

function roundTrips(storage: string) {
  const { display, mentions } = toDisplay(storage);
  expect(toStorage(display, mentions)).toBe(storage);
  return display;
}

describe("toDisplay / toStorage", () => {
  it("shows a mention link as @title and maps it back", () => {
    expect(roundTrips(`Check [Motor](${MOTOR}) first.`)).toBe("Check @Motor first.");
  });

  it("handles multi-word titles and several mentions", () => {
    expect(roundTrips(`[Motor Mount](${MOUNT}) and [Avionics Overview](${ARTICLE})`)).toBe(
      "@Motor Mount and @Avionics Overview",
    );
  });

  it("leaves images, external links and file links alone", () => {
    const text = `![Motor](${MOTOR}) [site](https://example.com) [f.pdf](/api/v1/files/abc/download/)`;
    expect(roundTrips(text)).toBe(text);
  });

  it("keeps raw links when one title points at two different items", () => {
    const text = `[Motor](${MOTOR}) vs [Motor](${MOUNT})`;
    expect(roundTrips(text)).toBe(text);
  });

  it("keeps the raw link when the text already has a literal @title", () => {
    const text = `email @Motor about [Motor](${MOTOR})`;
    expect(roundTrips(text)).toBe(text);
  });

  it("stays lossless when a shorter title is followed by text forming a longer one", () => {
    roundTrips(`[Motor](${MOTOR}) Mount and [Motor Mount](${MOUNT})`);
  });

  it("turns a re-typed @title back into the link while editing", () => {
    const { display, mentions } = toDisplay(`[Motor](${MOTOR})`);
    expect(toStorage(`${display} then @Motor again`, mentions)).toBe(
      `[Motor](${MOTOR}) then [Motor](${MOTOR}) again`,
    );
  });

  it("drops the link once the @title is edited", () => {
    const { mentions } = toDisplay(`[Motor](${MOTOR})`);
    expect(toStorage("@Moto", mentions)).toBe("@Moto");
  });

  it("escapes regex characters in titles", () => {
    expect(roundTrips(`[C++ (v2)?](${MOTOR})`)).toBe("@C++ (v2)?");
  });
});

describe("parseMentionHref", () => {
  it("recognises item routes", () => {
    expect(parseMentionHref(ARTICLE)).toEqual({ type: "article", id: "3f2b1c4e-0000-4000-8000-000000000003" });
    expect(parseMentionHref(MOTOR)?.type).toBe("component");
  });

  it("rejects everything else", () => {
    expect(parseMentionHref("https://example.com/components/x")).toBeNull();
    expect(parseMentionHref("/api/v1/files/abc/download/")).toBeNull();
    expect(parseMentionHref(undefined)).toBeNull();
  });
});
