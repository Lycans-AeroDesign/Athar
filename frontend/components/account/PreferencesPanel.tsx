"use client";

import { useLocale, useTranslations } from "next-intl";

import { Combobox } from "@/components/ui/Combobox";
import { usePathname, useRouter } from "@/i18n/navigation";
import { locales, localeNames, type Locale } from "@/i18n/request";
import { updateMe } from "@/lib/api/accounts";
import { useAuth } from "@/lib/auth/AuthProvider";
import { useTheme } from "@/lib/theme/ThemeProvider";
import type { ThemePreference } from "@/lib/theme/theme";

const LANGUAGE_OPTIONS = locales.map((code) => ({
  value: code,
  label: localeNames[code],
}));
const THEME_OPTIONS: ThemePreference[] = ["light", "dark", "system"];

// Per-viewer preferences (theme/language via cookies, the list-filter toggle
// via user.preferences on the backend) - lives on My Account rather than
// Organization Settings since none of it affects anyone else. Each applies
// immediately, with no Save step. Theme/language mirror the equivalent
// pickers in the account menu (see TopBar.tsx).
export function PreferencesPanel() {
  const t = useTranslations("account.preferences");
  const topbarT = useTranslations("topbar");
  const { theme, setTheme } = useTheme();
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const { user, updateUser } = useAuth();

  async function handleEngineeringListFiltersChange(checked: boolean) {
    if (!user) return;
    const updated = await updateMe({
      preferences: { ...user.preferences, engineering_list_filters: checked },
    });
    updateUser(updated);
  }

  const themeLabels: Record<ThemePreference, string> = {
    light: topbarT("themeLight"),
    dark: topbarT("themeDark"),
    system: topbarT("themeSystem"),
  };

  return (
    <div className="bg-surface rounded-xl border border-outline-variant p-6 space-y-6">
      <div>
        <h2 className="font-headline-md text-headline-md text-on-surface">{t("title")}</h2>
        <p className="font-body-md text-body-md text-on-surface-variant mt-1">{t("description")}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Combobox
          label={t("themeLabel")}
          options={THEME_OPTIONS.map((value) => ({
            value,
            label: themeLabels[value],
          }))}
          value={theme}
          onChange={(value) => setTheme(value as ThemePreference)}
        />

        <Combobox
          label={t("languageLabel")}
          options={LANGUAGE_OPTIONS}
          value={locale}
          onChange={(value) => router.replace(pathname, { locale: value as Locale })}
        />
      </div>

      {user && (
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={user.preferences.engineering_list_filters ?? true}
            onChange={(e) => handleEngineeringListFiltersChange(e.target.checked)}
            className="mt-1 rounded border-outline-variant text-primary focus:ring-primary w-4 h-4 shrink-0"
          />
          <span>
            <span className="block font-body-md text-body-md text-on-surface">{t("engineeringListFiltersLabel")}</span>
            <span className="block font-body-md text-body-md text-on-surface-variant">
              {t("engineeringListFiltersDescription")}
            </span>
          </span>
        </label>
      )}
    </div>
  );
}
