import type { User } from "@/lib/api/types";

/**
 * "What's new" release notes shown to users in a pop-up after an upgrade
 * (components/whatsNew/WhatsNewDialog.tsx).
 *
 * Adding an entry at release time:
 *  1. Add it at the TOP of WHATS_NEW (newest first) with a new unique `id`.
 *  2. Add `whatsNew.entries.<id>.title` and `.body` to BOTH i18n/messages/en.json
 *     and ar.json, in plain language for team members, not developers.
 *     lib/whatsNew.test.ts fails if a translation is missing.
 *  3. Set `permission` (an RBAC codename) or `platformAdmin` when only some users
 *     can use the change, so everyone else isn't shown something they can't open.
 *
 * Only include what users notice: features, visible improvements and bug fixes.
 * Internal changes (CI, refactors, server tuning) stay in CHANGELOG.md.
 */

export type WhatsNewKind = "new" | "improved" | "fixed";

export interface WhatsNewEntry {
  /** Unique, never reused. Also the i18n key under whatsNew.entries. */
  id: string;
  /** Release date, YYYY-MM-DD. */
  date: string;
  kind: WhatsNewKind;
  /** Where to try it, e.g. "/trash". Shown as an "Open" link. */
  href?: string;
  /** Only shown to users holding this permission codename. */
  permission?: string;
  /** Only shown to instance operators (is_superuser). */
  platformAdmin?: boolean;
}

export const WHATS_NEW: readonly WhatsNewEntry[] = [
  { id: "platformErrorLog", date: "2026-11-15", kind: "new", href: "/platform/errors", platformAdmin: true },
  { id: "platformMobile", date: "2026-11-15", kind: "fixed", href: "/platform", platformAdmin: true },
  { id: "trash", date: "2026-11-15", kind: "new", href: "/trash" },
  { id: "articleRevisions", date: "2026-11-15", kind: "new", href: "/knowledge" },
  { id: "shareLinks", date: "2026-11-15", kind: "new", permission: "share_link.create" },
  { id: "shareLinksSettings", date: "2026-11-15", kind: "new", href: "/settings/features", permission: "organization.manage" },
  { id: "fasterImages", date: "2026-11-15", kind: "improved" },
  { id: "componentPhotoPreview", date: "2026-11-15", kind: "improved", href: "/components" },
  { id: "mentionsEditor", date: "2026-11-15", kind: "improved" },
  { id: "loadingAndUnsavedChanges", date: "2026-11-15", kind: "fixed" },
  { id: "arabicLayout", date: "2026-11-15", kind: "fixed" },
  { id: "trainingUploads", date: "2026-11-15", kind: "fixed", href: "/training" },
  { id: "importChecks", date: "2026-11-15", kind: "fixed" },
  { id: "backupsReliability", date: "2026-11-15", kind: "fixed", href: "/settings/backups", permission: "organization.manage" },
  { id: "searchKeyboard", date: "2026-11-14", kind: "new" },
  { id: "longTextRoll", date: "2026-11-14", kind: "improved" },
  { id: "mobileLists", date: "2026-11-14", kind: "fixed" },
];

/** Entries this user can actually use. */
export function entriesForUser(user: User, entries: readonly WhatsNewEntry[] = WHATS_NEW): WhatsNewEntry[] {
  return entries.filter(
    (entry) =>
      (!entry.platformAdmin || user.is_superuser) && (!entry.permission || user.permissions.includes(entry.permission)),
  );
}

/**
 * Entries this user hasn't been shown yet, newest first. `whats_new_seen` holds the
 * newest entry id they've been shown; anything above it in the list is new to them.
 * Without one (first time, or the id was removed), only changes released after they
 * joined count, so a brand-new member isn't greeted with a backlog.
 */
export function unseenEntries(user: User, entries: readonly WhatsNewEntry[] = WHATS_NEW): WhatsNewEntry[] {
  const seenIndex = entries.findIndex((entry) => entry.id === user.preferences.whats_new_seen);
  const unseen =
    seenIndex >= 0 ? entries.slice(0, seenIndex) : entries.filter((entry) => entry.date > user.date_joined.slice(0, 10));
  return entriesForUser(user, unseen);
}

/** The value to save as `whats_new_seen` once the user has been shown the list. */
export function latestEntryId(entries: readonly WhatsNewEntry[] = WHATS_NEW): string | undefined {
  return entries[0]?.id;
}

/** Fired on `window` by the account menu's "What's new" item; WhatsNewDialog opens the full list. */
export const OPEN_WHATS_NEW_EVENT = "athar:open-whats-new";

export function openWhatsNew(): void {
  window.dispatchEvent(new Event(OPEN_WHATS_NEW_EVENT));
}
