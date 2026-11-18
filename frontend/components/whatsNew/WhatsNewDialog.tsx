"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Modal } from "@/components/ui/Modal";
import { Link } from "@/i18n/navigation";
import { updateMe } from "@/lib/api/accounts";
import { useAuth } from "@/lib/auth/AuthProvider";
import { formatDate } from "@/lib/datetime";
import { useOrganization } from "@/lib/organization/OrganizationProvider";
import {
  entriesForUser,
  latestEntryId,
  OPEN_WHATS_NEW_EVENT,
  unseenEntries,
  type WhatsNewEntry,
  type WhatsNewKind,
} from "@/lib/whatsNew";

// The callout palette (GitHub's) stays legible in both themes; the color only
// tints the icon tile, while the heading text stays on-surface for contrast.
const KINDS: { kind: WhatsNewKind; icon: string; tile: string }[] = [
  { kind: "new", icon: "auto_awesome", tile: "bg-callout-important/15 text-callout-important" },
  { kind: "improved", icon: "bolt", tile: "bg-callout-note/15 text-callout-note" },
  { kind: "fixed", icon: "check_circle", tile: "bg-callout-tip/15 text-callout-tip" },
];

/** Mounted once in the protected layout. Opens by itself when there are entries this
 * user hasn't seen (once per update), and on demand from the account menu
 * (openWhatsNew), which shows everything they can use. */
export function WhatsNewDialog() {
  const t = useTranslations("whatsNew");
  const { user, updateUser } = useAuth();
  const { settings } = useOrganization();
  const [entries, setEntries] = useState<WhatsNewEntry[] | null>(null);
  const autoOpened = useRef(false);

  // Auto-open once per session, after the shell has painted. Waits for the
  // first-run product tour instead of stacking on top of it.
  useEffect(() => {
    if (autoOpened.current || !user || !settings) return;
    if (settings.product_tour_enabled && !user.preferences.has_completed_tour) return;
    const unseen = unseenEntries(user);
    if (unseen.length === 0) return;
    const timeout = setTimeout(() => {
      autoOpened.current = true;
      setEntries(unseen);
    }, 800);
    return () => clearTimeout(timeout);
  }, [user, settings]);

  useEffect(() => {
    const open = () => {
      if (user) setEntries(entriesForUser(user));
    };
    window.addEventListener(OPEN_WHATS_NEW_EVENT, open);
    return () => window.removeEventListener(OPEN_WHATS_NEW_EVENT, open);
  }, [user]);

  function close() {
    setEntries(null);
    const latest = latestEntryId();
    if (!user || !latest || user.preferences.whats_new_seen === latest) return;
    // Saved even if this user couldn't see the newest entry, so it isn't re-checked.
    updateMe({ preferences: { ...user.preferences, whats_new_seen: latest } })
      .then(updateUser)
      .catch(() => {
        // Not saved: the pop-up shows again next visit, which is harmless.
      });
  }

  const isOpen = entries !== null;

  // One date for the whole list: the newest release in it, even when the list spans
  // several releases. Noon UTC keeps the calendar day in every time zone.
  let released: string | undefined;
  if (entries && entries.length > 0) {
    const newest = entries
      .map((entry) => entry.date)
      .sort()
      .at(-1);
    released = t("released", { date: formatDate(`${newest}T12:00:00Z`) });
  }

  return (
    <Modal
      open={isOpen}
      onOpenChange={(open) => !open && close()}
      title={t("title")}
      description={released}
      wide
      footer={<Button onClick={close}>{t("gotIt")}</Button>}
    >
      {entries && entries.length === 0 ? (
        <p className="font-body-md text-body-md text-on-surface-variant">{t("empty")}</p>
      ) : (
        <div className="space-y-6">
          {KINDS.map(({ kind, icon, tile }) => {
            const group = (entries ?? []).filter((entry) => entry.kind === kind);
            if (group.length === 0) return null;
            return (
              <section key={kind} aria-labelledby={`whats-new-${kind}`}>
                <div className="flex items-center gap-3 mb-3">
                  <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${tile}`}>
                    <Icon name={icon} size={18} />
                  </span>
                  <h3 id={`whats-new-${kind}`} className="font-body-lg text-body-lg font-semibold text-on-surface">
                    {t(`kind.${kind}`)}
                  </h3>
                  <span className="rounded-full bg-surface-container-high px-2 py-0.5 font-label-caps text-label-caps text-on-surface-variant">
                    {group.length}
                  </span>
                </div>
                <ul className="divide-y divide-outline-variant overflow-hidden rounded-xl border border-outline-variant">
                  {group.map((entry) => (
                    <li key={entry.id}>
                      {entry.href ? (
                        <Link
                          href={entry.href}
                          onClick={close}
                          className="group flex items-center gap-3 px-4 py-3 outline-none transition-colors hover:bg-surface-container-low focus-visible:bg-surface-container-low focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
                        >
                          <EntryText id={entry.id} />
                          <Icon
                            name="chevron_right"
                            size={20}
                            className="shrink-0 text-on-surface-variant transition-transform group-hover:translate-x-0.5 rtl:group-hover:-translate-x-0.5"
                          />
                        </Link>
                      ) : (
                        <div className="px-4 py-3">
                          <EntryText id={entry.id} />
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </Modal>
  );
}

function EntryText({ id }: { id: string }) {
  const t = useTranslations("whatsNew.entries");
  return (
    <div className="min-w-0 flex-1">
      <p className="font-body-md text-body-md font-semibold text-on-surface">{t(`${id}.title`)}</p>
      <p className="font-body-md text-body-md text-on-surface-variant mt-0.5">{t(`${id}.body`)}</p>
    </div>
  );
}
