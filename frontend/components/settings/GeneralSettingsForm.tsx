"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { Combobox } from "@/components/ui/Combobox";
import { usePathname, useRouter } from "@/i18n/navigation";
import { locales, localeNames, type Locale } from "@/i18n/request";
import { updateMe } from "@/lib/api/accounts";
import { updateGeneralSettings } from "@/lib/api/organization";
import type { OrganizationSettings } from "@/lib/api/types";
import { useAuth } from "@/lib/auth/AuthProvider";
import { useTheme } from "@/lib/theme/ThemeProvider";
import type { ThemePreference } from "@/lib/theme/theme";

const LANGUAGE_OPTIONS = locales.map((code) => ({ value: code, label: localeNames[code] }));
const THEME_OPTIONS: ThemePreference[] = ["light", "dark", "system"];

interface GeneralSettingsFormProps {
  settings: OrganizationSettings;
  onUpdate: (settings: OrganizationSettings) => void;
  canEdit: boolean;
}

export function GeneralSettingsForm({ settings, onUpdate, canEdit }: GeneralSettingsFormProps) {
  const t = useTranslations("settings.general");
  const commonT = useTranslations("common");
  const topbarT = useTranslations("topbar");
  const { theme, setTheme } = useTheme();
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const { user, updateUser } = useAuth();
  const [name, setName] = useState(settings.name);
  const [primaryDomain, setPrimaryDomain] = useState(settings.primary_domain);
  const [isSaving, setIsSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  async function handleSave() {
    setIsSaving(true);
    try {
      const updated = await updateGeneralSettings({ name, primary_domain: primaryDomain });
      onUpdate(updated);
      setSavedAt(Date.now());
    } finally {
      setIsSaving(false);
    }
  }

  async function handleEngineeringListFiltersChange(checked: boolean) {
    if (!user) return;
    const updated = await updateMe({ preferences: { ...user.preferences, engineering_list_filters: checked } });
    updateUser(updated);
  }

  const themeLabels: Record<ThemePreference, string> = {
    light: topbarT("themeLight"),
    dark: topbarT("themeDark"),
    system: topbarT("themeSystem"),
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="bg-surface rounded-xl border border-outline-variant p-6 space-y-6">
        <h2 className="font-headline-md text-headline-md text-on-surface">{t("title")}</h2>

        <div className="space-y-2">
          <label className="block font-label-caps text-label-caps text-on-surface-variant uppercase">
            {t("nameLabel")}
          </label>
          <input
            className="block w-full px-4 py-2 font-body-md text-body-md text-on-surface bg-surface-container border border-outline-variant rounded-lg focus:ring-1 focus:ring-primary focus:border-primary outline-none transition-colors disabled:opacity-60"
            disabled={!canEdit}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <label className="block font-label-caps text-label-caps text-on-surface-variant uppercase">
            {t("domainLabel")}
          </label>
          <input
            className="block w-full px-4 py-2 font-mono-sm text-mono-sm text-on-surface bg-surface-container border border-outline-variant rounded-lg focus:ring-1 focus:ring-primary focus:border-primary outline-none transition-colors disabled:opacity-60"
            disabled={!canEdit}
            placeholder={t("domainPlaceholder")}
            value={primaryDomain}
            onChange={(e) => setPrimaryDomain(e.target.value)}
          />
        </div>

        {canEdit && (
          <div className="flex items-center gap-4">
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? commonT("saving") : commonT("save")}
            </Button>
            {savedAt && (
              <span className="font-body-md text-body-md text-on-surface-variant">
                {commonT("saved")}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Theme, language, and the list-filter toggle below are all per-viewer
          preferences (theme/language via cookies, the toggle via
          user.preferences on the backend), not part of the organization's
          saved settings above - each applies immediately, with no Save
          Changes step. Theme/language mirror the equivalent pickers in the
          account menu (see TopBar.tsx). */}
      <div className="bg-surface rounded-xl border border-outline-variant p-6 space-y-6">
        <h2 className="font-headline-md text-headline-md text-on-surface">{t("preferencesTitle")}</h2>

        <Combobox
          label={t("themeLabel")}
          options={THEME_OPTIONS.map((value) => ({ value, label: themeLabels[value] }))}
          value={theme}
          onChange={(value) => setTheme(value as ThemePreference)}
        />

        <Combobox
          label={t("languageLabel")}
          options={LANGUAGE_OPTIONS}
          value={locale}
          onChange={(value) => router.replace(pathname, { locale: value as Locale })}
        />

        {user && (
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={user.preferences.engineering_list_filters ?? true}
              onChange={(e) => handleEngineeringListFiltersChange(e.target.checked)}
              className="mt-1 rounded border-outline-variant text-primary focus:ring-primary w-4 h-4 shrink-0"
            />
            <span>
              <span className="block font-body-md text-body-md text-on-surface">
                {t("engineeringListFiltersLabel")}
              </span>
              <span className="block font-body-md text-body-md text-on-surface-variant">
                {t("engineeringListFiltersDescription")}
              </span>
            </span>
          </label>
        )}
      </div>
    </div>
  );
}
