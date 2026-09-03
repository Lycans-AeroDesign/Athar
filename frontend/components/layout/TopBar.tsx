"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";

import { GlobalSearch } from "@/components/layout/GlobalSearch";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Icon } from "@/components/ui/Icon";
import { Menu } from "@/components/ui/Menu";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { locales, localeNames, type Locale } from "@/i18n/request";
import { useAuth } from "@/lib/auth/AuthProvider";
import { formatPersonName } from "@/lib/format";
import { useOrganization } from "@/lib/organization/OrganizationProvider";
import { useTheme } from "@/lib/theme/ThemeProvider";
import type { ThemePreference } from "@/lib/theme/theme";

interface TopBarProps {
  /** Opens the off-canvas SideNav drawer below the `lg` breakpoint (see the (protected) layout). */
  onOpenMenu: () => void;
}

export function TopBar({ onOpenMenu }: TopBarProps) {
  const { user, logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const { settings } = useOrganization();
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const t = useTranslations("topbar");
  const [confirmLogoutOpen, setConfirmLogoutOpen] = useState(false);

  async function handleLogout() {
    await logout();
    router.push("/login");
  }

  const displayName = formatPersonName(user) ?? "";
  // The free-text team role (e.g. "Lead Systems Integration") is the primary
  // subtitle when the user has set one; RBAC role names are the fallback so
  // this line isn't empty for accounts that haven't.
  const subtitle = user?.title || (user?.roles?.length ? user.roles.join(", ") : "");
  const initial = user?.email?.[0]?.toUpperCase() ?? "?";

  return (
    <header className="bg-surface text-primary font-label-caps text-label-caps border-b border-outline-variant flex items-center justify-between gap-2 px-4 sm:px-6 h-16 z-10">
      <button
        type="button"
        onClick={onOpenMenu}
        aria-label={t("openMenu")}
        className="lg:hidden shrink-0 text-on-surface-variant hover:text-primary opacity-80 hover:opacity-100 transition-opacity"
      >
        <Icon name="menu" />
      </button>

      <div className="flex-1 flex items-center max-w-2xl">
        <GlobalSearch />
      </div>

      <div className="flex items-center gap-2 sm:gap-4">
        {/* Notifications button hidden until the feature is implemented - see t("notifications"), kept in messages for when it returns. */}
        <Link
          className="hidden sm:inline-flex text-on-surface-variant hover:text-primary opacity-80 hover:opacity-100 transition-opacity"
          href="/settings"
          aria-label={t("settings")}
        >
          <Icon name="settings" />
        </Link>
        <div className="hidden sm:block h-8 w-px bg-outline-variant mx-1" />
        <Menu
          trigger={
            <button
              className="flex items-center gap-2 rounded-xl border border-outline-variant ps-2 sm:ps-4 pe-2 py-1 bg-surface-container hover:bg-surface-container-high transition-colors cursor-pointer"
              type="button"
              aria-label={t("accountMenu")}
            >
              <Icon name="expand_more" size={18} className="hidden sm:block text-on-surface-variant shrink-0" />
              <span className="hidden sm:flex flex-col items-end leading-tight text-end">
                <span className="font-body-md text-body-md font-semibold text-on-surface normal-case">
                  {displayName}
                </span>
                {subtitle && (
                  <span className="text-[11px] font-normal tracking-normal normal-case text-on-surface-variant">
                    {subtitle}
                  </span>
                )}
              </span>
              <span className="h-8 w-8 shrink-0 rounded-full border border-outline-variant bg-primary text-on-primary flex items-center justify-center font-label-caps text-label-caps">
                {initial}
              </span>
            </button>
          }
          header={user?.email}
          items={[
            { label: t("myAccount"), icon: "account", onSelect: () => router.push("/account") },
            { type: "separator" },
            {
              type: "submenu",
              label: t("theme"),
              icon: "dark_mode",
              value: theme,
              onChange: (value) => setTheme(value as ThemePreference),
              options: [
                { value: "light", label: t("themeLight"), icon: "light_mode" },
                { value: "dark", label: t("themeDark"), icon: "dark_mode" },
                { value: "system", label: t("themeSystem"), icon: "computer" },
              ],
            },
            {
              type: "submenu",
              label: t("language"),
              icon: "language",
              value: locale,
              onChange: (value) => router.replace(pathname, { locale: value as Locale }),
              options: locales.map((code) => ({ value: code, label: localeNames[code] })),
            },
            { type: "separator" },
            { label: t("logout"), icon: "logout", onSelect: () => setConfirmLogoutOpen(true), danger: true },
          ]}
        />
      </div>

      <ConfirmModal
        open={confirmLogoutOpen}
        onOpenChange={setConfirmLogoutOpen}
        title={t("logoutConfirmTitle")}
        description={t("logoutConfirmDescription", { orgName: settings?.name ?? "Athar" })}
        confirmLabel={t("logoutConfirmAction")}
        danger
        onConfirm={handleLogout}
      />
    </header>
  );
}
