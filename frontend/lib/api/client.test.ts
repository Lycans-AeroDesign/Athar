import { describe, expect, it } from "vitest";

import { extractApiError } from "./client";

// extractApiError only ever touches res.json() and res.status, so a
// fake Response-shaped object is enough - no real fetch/network needed.
function fakeResponse(body: unknown, status = 400): Response {
  return {
    status,
    json: async () => body,
  } as Response;
}

describe("extractApiError", () => {
  it("flattens a {detail: ...} error into message, with no field errors", async () => {
    const result = await extractApiError(fakeResponse({ detail: "Not found." }, 404), "/api/v1/thing/");
    expect(result).toEqual({ message: "Not found.", fields: {} });
  });

  it("flattens a field-errors dict into one message plus the per-field breakdown", async () => {
    const result = await extractApiError(
      fakeResponse({ title: ["This field is required."], non_field_errors: ["Something else is wrong."] }),
      "/api/v1/thing/",
    );
    expect(result.fields).toEqual({
      title: "This field is required.",
      non_field_errors: "Something else is wrong.",
    });
    expect(result.message).toContain("This field is required.");
    expect(result.message).toContain("Something else is wrong.");
  });

  it("falls back to a generic status-based message when the body isn't JSON", async () => {
    const res = {
      status: 500,
      json: async () => {
        throw new Error("not JSON");
      },
    } as unknown as Response;

    const result = await extractApiError(res, "/api/v1/thing/");
    expect(result).toEqual({ message: "Request to /api/v1/thing/ failed with 500", fields: {} });
  });
});
