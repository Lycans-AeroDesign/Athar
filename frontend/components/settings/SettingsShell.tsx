"use client";

import { useTranslations } from "next-intl";
import { useSelectedLayoutSegment } from "next/navigation";
import { createContext, useContext, useEffect, useState, type MouseEvent, type ReactNode } from "react";

import { useVisibleSettingsGroups } from "@/components/settings/sections";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Icon } from "@/components/ui/Icon";
import { Link, useRouter } from "@/i18n/navigation";

// Reported by the sections with a Save Changes step (Identity & Branding,
// Features) - moving to another section unmounts the form and would
// silently drop its edits, so the nav (and the mobile back link) below confirms first.
const SettingsDirtyContext = createContext<(isDirty: boolean) => void>(() => {});

export function useReportSettingsDirty() {
  return useContext(SettingsDirtyContext);
}

// Shared frame for every /settings/<section> route: page header, the grouped
// section nav (a sticky side list from `lg` up, a drill-down list below it), and the
// unsaved-changes guard for moving between sections.
export function SettingsShell({ children }: { children: ReactNode }) {
  const t = useTranslations("settings");
  const commonT = useTranslations("common");
  const modalT = useTranslations("modal");
  const router = useRouter();
  const activeSection = useSelectedLayoutSegment();
  const groups = useVisibleSettingsGroups();
  const [isDirty, setIsDirty] = useState(false);
  const [pendingHref, setPendingHref] = useState<string | null>(null);

  // Covers reload/closing the tab, which the confirm modal below can't.
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  function handleLinkClick(e: MouseEvent<HTMLAnchorElement>, href: string) {
    // Let modified clicks (new tab/window) through untouched - they don't
    // unmount the current form.
    if (!isDirty || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    setPendingHref(href);
  }

  const activeGroup = groups.find((group) => group.sections.some((section) => section.id === activeSection));

  return (
    <section>
      {/* Below `lg` this is a two-level drill-down, like a phone's own
          settings app: /settings is a full-width list of sections, and each
          section page swaps the page header for a back link plus that
          section's own title. From `lg` up the list is a sticky side nav
          beside whichever section is open (and /settings just forwards to
          the first one - see settings/page.tsx). */}
      {activeSection ? (
        <div className="lg:hidden">
          <Link
            href="/settings"
            onClick={(e) => handleLinkClick(e, "/settings")}
            className="inline-flex items-center gap-1 -ms-1 py-1 font-body-md text-body-md text-primary"
          >
            <Icon name="chevron_right" size={18} className="rotate-180 rtl:rotate-0" />
            {t("title")}
          </Link>
          {activeGroup && (
            <p className="mt-3 font-label-caps text-label-caps font-bold text-on-surface uppercase">
              {t(`groups.${activeGroup.id}`)}
            </p>
          )}
          <h1 className="font-headline-lg text-headline-lg text-on-surface">{t(`sections.${activeSection}`)}</h1>
        </div>
      ) : null}
      <div className={activeSection ? "hidden lg:block" : undefined}>
        <h1 className="font-display text-display text-on-surface">{t("title")}</h1>
        <p className="font-body-lg text-body-lg text-on-surface-variant mt-2">{t("description")}</p>
      </div>

      <div className="mt-6 grid grid-cols-1 lg:grid-cols-[13rem_minmax(0,1fr)] gap-6 lg:gap-8 items-start">
        {groups.length > 0 && (
          <nav
            aria-label={t("sectionNavLabel")}
            className={`${activeSection ? "hidden lg:block" : ""} lg:sticky lg:top-0 space-y-6 lg:space-y-5`}
          >
            {groups.map((group) => (
              <div key={group.id} className="space-y-2 lg:space-y-1">
                <h2 className="px-1 lg:px-3 lg:pb-1 font-label-caps text-label-caps font-bold text-on-surface uppercase">
                  {t(`groups.${group.id}`)}
                </h2>
                {/* A grouped card of rows on phones; plain list on desktop. */}
                <div className="overflow-hidden rounded-xl border border-outline-variant bg-surface divide-y divide-outline-variant lg:overflow-visible lg:rounded-none lg:border-0 lg:bg-transparent lg:divide-y-0 lg:space-y-1">
                  {group.sections.map((section) => {
                    const href = `/settings/${section.id}`;
                    const isActive = section.id === activeSection;
                    return (
                      <Link
                        key={section.id}
                        href={href}
                        onClick={(e) => handleLinkClick(e, href)}
                        aria-current={isActive ? "page" : undefined}
                        className={`flex items-center gap-3 px-4 py-3.5 lg:px-3 lg:py-2 lg:rounded-lg font-body-md text-body-md transition-colors ${
                          isActive
                            ? "bg-primary-container text-on-primary-container font-semibold"
                            : "text-on-surface lg:text-on-surface-variant hover:bg-surface-variant hover:text-on-surface"
                        }`}
                      >
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-container text-on-surface-variant lg:h-auto lg:w-auto lg:bg-transparent lg:text-current">
                          <Icon name={section.icon} size={18} />
                        </span>
                        <span className="flex-1 min-w-0 truncate">{t(`sections.${section.id}`)}</span>
                        <Icon
                          name="chevron_right"
                          size={18}
                          className="lg:hidden shrink-0 text-on-surface-variant rtl:rotate-180"
                        />
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>
        )}

        <div className={`min-w-0 ${groups.length === 0 ? "lg:col-span-2" : ""}`}>
          <SettingsDirtyContext.Provider value={setIsDirty}>{children}</SettingsDirtyContext.Provider>
        </div>
      </div>

      <ConfirmModal
        open={pendingHref !== null}
        onOpenChange={(open) => {
          if (!open) setPendingHref(null);
        }}
        title={modalT("discardTitle")}
        description={modalT("discardDescription")}
        confirmLabel={commonT("discard")}
        danger
        onConfirm={() => {
          if (pendingHref) router.push(pendingHref);
          setIsDirty(false);
          setPendingHref(null);
        }}
      />
    </section>
  );
}
