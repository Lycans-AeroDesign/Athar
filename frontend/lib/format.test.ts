import { describe, expect, it } from "vitest";

import { formatPersonName, getInitials } from "./format";

describe("formatPersonName", () => {
  it("prefers @username when set", () => {
    expect(
      formatPersonName({ first_name: "Ahmad", last_name: "Wael", email: "a@example.com", username: "ahmad" }),
    ).toBe("@ahmad");
  });

  it("falls back to 'First Last' when there's no username", () => {
    expect(formatPersonName({ first_name: "Ahmad", last_name: "Wael", email: "a@example.com" })).toBe("Ahmad Wael");
  });

  it("falls back to the email when both name fields are blank", () => {
    expect(formatPersonName({ first_name: "", last_name: "", email: "a@example.com" })).toBe("a@example.com");
  });

  it("returns null for a missing person", () => {
    expect(formatPersonName(null)).toBeNull();
    expect(formatPersonName(undefined)).toBeNull();
  });
});

describe("getInitials", () => {
  it("uses first-letter-of-first + first-letter-of-last, uppercased", () => {
    expect(getInitials({ first_name: "ahmad", last_name: "wael", email: "a@example.com" })).toBe("AW");
  });

  it("falls back to the first letter of the email when there's no name", () => {
    expect(getInitials({ first_name: "", last_name: "", email: "a@example.com" })).toBe("A");
  });

  it("returns '?' for a missing person", () => {
    expect(getInitials(null)).toBe("?");
    expect(getInitials(undefined)).toBe("?");
  });
});
