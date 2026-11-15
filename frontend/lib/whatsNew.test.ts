import { describe, expect, it } from "vitest";

import ar from "@/i18n/messages/ar.json";
import en from "@/i18n/messages/en.json";
import type { User } from "@/lib/api/types";

import { WHATS_NEW, entriesForUser, latestEntryId, unseenEntries, type WhatsNewEntry } from "./whatsNew";

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: "u1",
    email: "member@example.com",
    username: null,
    first_name: "",
    last_name: "",
    title: "",
    profile_picture: null,
    roles: [],
    permissions: [],
    preferences: {},
    email_visible: false,
    date_joined: "2026-01-01T09:00:00Z",
    is_active: true,
    is_superuser: false,
    ...overrides,
  };
}

const ENTRIES: WhatsNewEntry[] = [
  { id: "c", date: "2026-11-15", kind: "new" },
  { id: "adminOnly", date: "2026-11-15", kind: "new", permission: "organization.manage" },
  { id: "operatorOnly", date: "2026-11-14", kind: "fixed", platformAdmin: true },
  { id: "b", date: "2026-11-10", kind: "improved" },
  { id: "a", date: "2026-11-01", kind: "fixed" },
];

describe("WHATS_NEW catalogue", () => {
  it("has unique ids, newest first, with valid dates", () => {
    const ids = WHATS_NEW.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    const dates = WHATS_NEW.map((entry) => entry.date);
    expect([...dates].sort().reverse()).toEqual(dates);
    for (const date of dates) expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it.each([
    ["en", en],
    ["ar", ar],
  ])("has a title and body for every entry in %s", (_, messages) => {
    const texts = (messages as { whatsNew: { entries: Record<string, { title?: string; body?: string }> } }).whatsNew
      .entries;
    for (const entry of WHATS_NEW) {
      expect(texts[entry.id]?.title, `${entry.id}.title`).toBeTruthy();
      expect(texts[entry.id]?.body, `${entry.id}.body`).toBeTruthy();
    }
    expect(Object.keys(texts).sort()).toEqual(WHATS_NEW.map((entry) => entry.id).sort());
  });
});

describe("entriesForUser", () => {
  it("hides entries the user lacks the permission or operator status for", () => {
    expect(entriesForUser(makeUser(), ENTRIES).map((e) => e.id)).toEqual(["c", "b", "a"]);
    const admin = makeUser({ permissions: ["organization.manage"] });
    expect(entriesForUser(admin, ENTRIES).map((e) => e.id)).toEqual(["c", "adminOnly", "b", "a"]);
    const operator = makeUser({ is_superuser: true });
    expect(entriesForUser(operator, ENTRIES).map((e) => e.id)).toEqual(["c", "operatorOnly", "b", "a"]);
  });
});

describe("unseenEntries", () => {
  it("returns entries newer than the last one seen", () => {
    const user = makeUser({ preferences: { whats_new_seen: "b" } });
    expect(unseenEntries(user, ENTRIES).map((e) => e.id)).toEqual(["c"]);
  });

  it("returns nothing once the newest entry was seen", () => {
    const user = makeUser({ preferences: { whats_new_seen: latestEntryId(ENTRIES) } });
    expect(unseenEntries(user, ENTRIES)).toEqual([]);
  });

  it("without a saved id, shows only changes released after the user joined", () => {
    expect(unseenEntries(makeUser({ date_joined: "2026-11-05T10:00:00Z" }), ENTRIES).map((e) => e.id)).toEqual([
      "c",
      "b",
    ]);
    expect(unseenEntries(makeUser({ date_joined: "2026-11-16T08:00:00Z" }), ENTRIES)).toEqual([]);
  });

  it("falls back to the join date when the saved id no longer exists", () => {
    const user = makeUser({ date_joined: "2026-11-12T00:00:00Z", preferences: { whats_new_seen: "removed" } });
    expect(unseenEntries(user, ENTRIES).map((e) => e.id)).toEqual(["c"]);
  });
});
