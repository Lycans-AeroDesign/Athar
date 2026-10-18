"use client";

import { useTranslations } from "next-intl";

import { Can } from "@/components/auth/Can";
import { BrandMark } from "@/components/ui/BrandMark";
import { Icon } from "@/components/ui/Icon";
import { Link, usePathname } from "@/i18n/navigation";
import { apiUrl } from "@/lib/api/client";
import { useOrganization } from "@/lib/organization/OrganizationProvider";

// `permission` is optional: omit for anything every authenticated user can see; set it once the
// backing endpoint enforces a permission, so users who'd get a 403 don't see the item.
// `separatorBefore` draws a divider above the item (Bookmarks is a personal feature). `tourId`
// maps to a step target in lib/onboarding/tour.ts (data-tour="<tourId>").
const NAV_ITEMS: ReadonlyArray<{
  href: string;
  labelKey: string;
  icon: string;
  permission?: string;
  separatorBefore?: boolean;
  tourId?: string;
}> = [
  { href: "/", labelKey: "dashboard", icon: "dashboard", tourId: "nav-dashboard" },
  { href: "/knowledge", labelKey: "knowledge", icon: "menu_book", tourId: "nav-knowledge" },
  {
    href: "/projects",
    labelKey: "projects",
    icon: "architecture",
    permission: "project.read",
    tourId: "nav-projects",
  },
  {
    href: "/components",
    labelKey: "components",
    icon: "settings_input_component",
    permission: "component.read",
    tourId: "nav-components",
  },
  { href: "/sops", labelKey: "sops", icon: "description", permission: "sop.read", tourId: "nav-sops" },
  {
    href: "/failures",
    labelKey: "failures",
    icon: "report_problem",
    permission: "failure.read",
    tourId: "nav-failures",
  },
  { href: "/tests", labelKey: "tests", icon: "science", permission: "test.read", tourId: "nav-tests" },
  {
    href: "/documents",
    labelKey: "documents",
    icon: "folder",
    permission: "document.read",
    tourId: "nav-documents",
  },
  {
    href: "/training",
    labelKey: "training",
    icon: "school",
    permission: "training.read",
    tourId: "nav-training",
  },
  { href: "/bookmarks", labelKey: "bookmarks", icon: "bookmark", separatorBefore: true, tourId: "nav-bookmarks" },
];

interface SideNavProps {
  /** Whether the off-canvas drawer is open below the `lg` breakpoint - ignored at `lg` and up, where the nav is always visible. */
  open: boolean;
  onClose: () => void;
}

export function SideNav({ open, onClose }: SideNavProps) {
  const pathname = usePathname();
  const t = useTranslations("nav");
  const modalT = useTranslations("modal");
  const { settings } = useOrganization();

  return (
    <>
      {/* Backdrop - mobile/tablet only, and only while the drawer is open. */}
      {open && (
        <div
          className="fixed inset-0 bg-inverse-surface/40 z-30 lg:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <nav
        // The "hidden below lg" classes are max-lg-scoped on purpose: Tailwind's rtl variant compiles
        // to a zero-specificity :where() selector that lands after the lg show rule, so an unscoped
        // rtl hide rule overrode it at desktop widths in Arabic. Scoped to max-lg, no hide rule
        // exists at lg+ to win the tie.
        //
        // h-dvh, not h-screen: the Settings/About block is mt-auto in a fixed nav, and on mobile
        // 100vh ignores the URL bar, pushing it off-screen. dvh tracks the visible height.
        className={`bg-surface-container-low text-primary font-body-md text-body-md h-dvh w-64 border-e border-outline-variant flex flex-col fixed start-0 top-0 z-40 transition-transform duration-200 lg:translate-x-0 ${
          open ? "translate-x-0" : "max-lg:-translate-x-full max-lg:rtl:translate-x-full"
        }`}
      >
        <div className="p-6 border-b border-outline-variant">
          <div className="flex items-center gap-2">
            {settings?.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element -- external backend URL, not a local asset next/image can optimize.
              <img
                src={apiUrl(settings.logo_url)}
                alt={settings.name}
                className="h-8 w-8 rounded-lg object-contain"
              />
            ) : (
              <BrandMark className="h-8 w-8" />
            )}
            <div className="flex flex-col flex-1">
              <span className="font-headline-md text-headline-md font-bold text-primary">
                {settings?.name ?? "Athar"}
              </span>
              <span className="font-label-caps text-label-caps text-on-surface-variant">
                {t("tagline")}
              </span>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label={modalT("close")}
              className="lg:hidden text-on-surface-variant hover:text-on-surface transition-colors"
            >
              <Icon name="close" size={20} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto py-4 px-2 space-y-1">
          {NAV_ITEMS.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Can key={item.href} permission={item.permission}>
                <>
                  {item.separatorBefore && (
                    <div className="h-px bg-outline-variant my-2 mx-2" aria-hidden="true" />
                  )}
                  <Link
                    className={
                      isActive
                        ? "flex items-center gap-4 px-4 py-2 bg-primary-container text-on-primary-container font-bold rounded-xl transition-colors"
                        : "flex items-center gap-4 px-4 py-2 text-on-surface-variant hover:bg-surface-variant transition-colors duration-150 rounded-xl"
                    }
                    href={item.href}
                    data-tour={item.tourId}
                  >
                    <Icon name={item.icon} />
                    {t(item.labelKey)}
                  </Link>
                </>
              </Can>
            );
          })}
        </div>

        <div className="mt-auto p-2 border-t border-outline-variant space-y-1">
          <Link
            className={
              pathname.startsWith("/settings")
                ? "flex items-center gap-4 px-4 py-2 bg-primary-container text-on-primary-container font-bold rounded-xl transition-colors"
                : "flex items-center gap-4 px-4 py-2 text-on-surface-variant hover:bg-surface-variant transition-colors duration-150 rounded-xl"
            }
            href="/settings"
            data-tour="nav-settings"
          >
            <Icon name="settings" />
            {t("settings")}
          </Link>
          <Link
            className={
              pathname === "/help"
                ? "flex items-center gap-4 px-4 py-2 bg-primary-container text-on-primary-container font-bold rounded-xl transition-colors"
                : "flex items-center gap-4 px-4 py-2 text-on-surface-variant hover:bg-surface-variant transition-colors duration-150 rounded-xl"
            }
            href="/help"
          >
            <Icon name="help" />
            {t("help")}
          </Link>
        </div>
      </nav>
    </>
  );
}
