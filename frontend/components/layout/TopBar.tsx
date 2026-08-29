"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Icon } from "@/components/ui/Icon";
import { Menu } from "@/components/ui/Menu";
import { Link, useRouter } from "@/i18n/navigation";
import { useAuth } from "@/lib/auth/AuthProvider";
import { useOrganization } from "@/lib/organization/OrganizationProvider";
import { useTheme } from "@/lib/theme/ThemeProvider";
import type { ThemePreference } from "@/lib/theme/theme";

export function TopBar() {
  const { user, logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const { settings } = useOrganization();
  const router = useRouter();
  const t = useTranslations("topbar");
  const [confirmLogoutOpen, setConfirmLogoutOpen] = useState(false);

  async function handleLogout() {
    await logout();
    router.push("/login");
  }

  const displayName = user ? [user.first_name, user.last_name].filter(Boolean).join(" ") || user.email : "";
  const roleLabel = user?.roles?.length ? user.roles.join(", ") : "";
  const initial = user?.email?.[0]?.toUpperCase() ?? "?";

  return (
    <header className="bg-surface text-primary font-label-caps text-label-caps border-b border-outline-variant flex items-center justify-between px-6 h-16 z-10">
      <div className="flex-1 flex items-center max-w-2xl">
        <div className="relative w-full">
          <Icon
            name="search"
            className="absolute left-4 top-1/2 -translate-y-1/2 text-outline"
          />
          <input
            className="w-full bg-surface-container-low border border-outline-variant rounded-xl py-2 pl-[40px] pr-4 text-body-md font-body-md text-on-surface placeholder:text-outline focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
            placeholder={t("searchPlaceholder")}
            type="text"
          />
        </div>
      </div>

      <div className="flex items-center gap-4 ml-auto">
        <button
          className="text-on-surface-variant hover:text-primary opacity-80 hover:opacity-100 transition-opacity"
          type="button"
          aria-label={t("notifications")}
        >
          <Icon name="notifications" />
        </button>
        <Link
          className="text-on-surface-variant hover:text-primary opacity-80 hover:opacity-100 transition-opacity"
          href="/settings"
          aria-label={t("settings")}
        >
          <Icon name="settings" />
        </Link>
        <div className="h-8 w-px bg-outline-variant mx-1" />
        <Menu
          trigger={
            <button
              className="flex items-center gap-2 rounded-xl px-2 py-1 bg-surface-container hover:bg-surface-container-high transition-colors cursor-pointer"
              type="button"
              aria-label={t("accountMenu")}
            >
              <span className="flex flex-col items-end leading-tight text-right">
                <span className="font-body-md text-body-md font-semibold text-on-surface normal-case">
                  {displayName}
                </span>
                {roleLabel && (
                  <span className="text-[11px] font-normal tracking-normal normal-case text-on-surface-variant">
                    {roleLabel}
                  </span>
                )}
              </span>
              <span className="h-8 w-8 shrink-0 rounded-full border border-outline-variant bg-primary-container text-on-primary flex items-center justify-center font-label-caps text-label-caps">
                {initial}
              </span>
            </button>
          }
          header={user?.email}
          items={[
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
            { label: t("logout"), onSelect: () => setConfirmLogoutOpen(true), danger: true },
          ]}
        />
      </div>

      <ConfirmModal
        open={confirmLogoutOpen}
        onOpenChange={setConfirmLogoutOpen}
        title={t("logoutConfirmTitle")}
        description={t("logoutConfirmDescription", { orgName: settings?.name ?? "AeroKMS" })}
        confirmLabel={t("logoutConfirmAction")}
        danger
        onConfirm={handleLogout}
      />
    </header>
  );
}
