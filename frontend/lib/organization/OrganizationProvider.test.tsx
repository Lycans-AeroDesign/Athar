import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OrganizationProvider } from "./OrganizationProvider";
import type { OrganizationSettings } from "@/lib/api/types";

const getOrganizationSettings = vi.fn<() => Promise<Partial<OrganizationSettings>>>();
vi.mock("@/lib/api/organization", () => ({ getOrganizationSettings: () => getOrganizationSettings() }));

function iconHrefs() {
  return Array.from(document.head.querySelectorAll<HTMLLinkElement>('link[rel="icon"]')).map((link) =>
    link.getAttribute("href"),
  );
}

describe("OrganizationProvider favicon", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it("uses the uploaded favicon, cache-busted by updated_at, as the only icon link", async () => {
    getOrganizationSettings.mockResolvedValue({
      name: "Lycans",
      favicon_url: "/api/v1/organization/settings/favicon/",
      updated_at: "2026-10-12T19:49:55Z",
    });
    render(<OrganizationProvider>{null}</OrganizationProvider>);

    await waitFor(() =>
      expect(iconHrefs()).toEqual([
        expect.stringMatching(/\/api\/v1\/organization\/settings\/favicon\/\?v=2026-10-12T19%3A49%3A55Z$/),
      ]),
    );
  });

  it("falls back to the default favicon when none is uploaded", async () => {
    getOrganizationSettings.mockResolvedValue({ name: "Lycans", favicon_url: null, updated_at: "x" });
    render(<OrganizationProvider>{null}</OrganizationProvider>);

    await waitFor(() => expect(getOrganizationSettings).toHaveBeenCalled());
    expect(iconHrefs()).toEqual(["/favicon.ico"]);
  });
});
