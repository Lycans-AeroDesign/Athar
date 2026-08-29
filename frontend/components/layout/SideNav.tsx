"use client";

import { useTranslations } from "next-intl";

import { BrandMark } from "@/components/ui/BrandMark";
import { Icon } from "@/components/ui/Icon";
import { Link, usePathname } from "@/i18n/navigation";
import { apiUrl } from "@/lib/api/client";
import { useOrganization } from "@/lib/organization/OrganizationProvider";

// Routes are placeholders - pages get filled in later. Keeping the list here
// (rather than inline in JSX) makes it a single place to add the next page.
const NAV_ITEMS = [
  { href: "/", labelKey: "dashboard", icon: "dashboard" },
  { href: "/knowledge", labelKey: "knowledge", icon: "menu_book" },
  { href: "/projects", labelKey: "projects", icon: "architecture" },
  { href: "/components", labelKey: "components", icon: "settings_input_component" },
  { href: "/sops", labelKey: "sops", icon: "description" },
  { href: "/failures", labelKey: "failures", icon: "report_problem" },
] as const;

export function SideNav() {
  const pathname = usePathname();
  const t = useTranslations("nav");
  const { settings } = useOrganization();

  return (
    <nav className="bg-surface-container-low text-primary font-body-md text-body-md h-screen w-64 border-r border-outline-variant flex flex-col fixed left-0 top-0 z-20">
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
          <div className="flex flex-col">
            <span className="font-headline-md text-headline-md font-bold text-primary">
              {settings?.name ?? "AeroKMS"}
            </span>
            <span className="font-label-caps text-label-caps text-on-surface-variant">
              {t("tagline")}
            </span>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto py-4 px-2 space-y-1">
        {NAV_ITEMS.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              className={
                isActive
                  ? "flex items-center gap-4 px-4 py-2 bg-secondary-container text-on-secondary-container font-bold rounded-xl transition-colors"
                  : "flex items-center gap-4 px-4 py-2 text-on-surface-variant hover:bg-surface-variant transition-colors duration-150 rounded-xl"
              }
              href={item.href}
            >
              <Icon name={item.icon} filled={isActive} />
              {t(item.labelKey)}
            </Link>
          );
        })}
      </div>

      <div className="mt-auto p-2 border-t border-outline-variant space-y-1">
        <Link
          className={
            pathname === "/settings"
              ? "flex items-center gap-4 px-4 py-2 bg-secondary-container text-on-secondary-container font-bold rounded-xl transition-colors"
              : "flex items-center gap-4 px-4 py-2 text-on-surface-variant hover:bg-surface-variant transition-colors duration-150 rounded-xl"
          }
          href="/settings"
        >
          <Icon name="settings" filled={pathname === "/settings"} />
          {t("settings")}
        </Link>
        <Link
          className="flex items-center gap-4 px-4 py-2 text-on-surface-variant hover:bg-surface-variant transition-colors duration-150 rounded-xl"
          href="/about"
        >
          <Icon name="info" />
          {t("about")}
        </Link>
      </div>
    </nav>
  );
}
