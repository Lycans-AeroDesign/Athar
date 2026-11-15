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
  OPEN_WHATS_NEW_EVENT,
  entriesForUser,
  latestEntryId,
  unseenEntries,
  type WhatsNewEntry,
  type WhatsNewKind,
} from "@/lib/whatsNew";

const KINDS: { kind: WhatsNewKind; icon: string; badge: string }[] = [
  { kind: "new", icon: "auto_awesome", badge: "bg-primary-container text-on-primary-container" },
  { kind: "improved", icon: "bolt", badge: "bg-tertiary-container text-on-tertiary-container" },
  { kind: "fixed", icon: "check_circle", badge: "bg-secondary-container text-on-secondary-container" },
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

  return (
    <Modal
      open={isOpen}
      onOpenChange={(open) => !open && close()}
      title={t("title")}
      description={entries && entries.length > 0 ? t("description") : undefined}
      wide
      footer={<Button onClick={close}>{t("gotIt")}</Button>}
    >
      {entries && entries.length === 0 ? (
        <p className="font-body-md text-body-md text-on-surface-variant">{t("empty")}</p>
      ) : (
        <div className="space-y-6">
          {KINDS.map(({ kind, icon, badge }) => {
            const group = (entries ?? []).filter((entry) => entry.kind === kind);
            if (group.length === 0) return null;
            return (
              <section key={kind} aria-labelledby={`whats-new-${kind}`}>
                <h3
                  id={`whats-new-${kind}`}
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 mb-3 font-label-caps text-label-caps ${badge}`}
                >
                  <Icon name={icon} size={14} />
                  {t(`kind.${kind}`)}
                </h3>
                <ul className="space-y-4">
                  {group.map((entry) => (
                    <li key={entry.id} className="min-w-0">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                        <h4 className="font-body-md text-body-md font-semibold text-on-surface">
                          {t(`entries.${entry.id}.title`)}
                        </h4>
                        <span className="font-mono-sm text-mono-sm text-on-surface-variant">
                          {formatDate(`${entry.date}T12:00:00Z`)}
                        </span>
                      </div>
                      <p className="font-body-md text-body-md text-on-surface-variant mt-0.5">
                        {t(`entries.${entry.id}.body`)}
                      </p>
                      {entry.href && (
                        <Link
                          href={entry.href}
                          onClick={close}
                          className="inline-flex items-center gap-1 mt-1 font-body-md text-body-md text-primary hover:underline"
                        >
                          {t("open")}
                          <Icon name="arrow_forward" size={14} />
                        </Link>
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
