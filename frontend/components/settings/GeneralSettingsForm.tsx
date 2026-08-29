"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { Combobox } from "@/components/ui/Combobox";
import { locales, localeNames } from "@/i18n/request";
import { updateGeneralSettings } from "@/lib/api/organization";
import type { OrganizationSettings } from "@/lib/api/types";

// Driven by the actual set of available translations (i18n/messages/*.json
// via i18n/request.ts), not a separate hardcoded catalogue - if a language
// isn't translated yet, it shouldn't be selectable here.
const LANGUAGE_OPTIONS = locales.map((code) => ({ value: code, label: localeNames[code] }));

interface GeneralSettingsFormProps {
  settings: OrganizationSettings;
  onUpdate: (settings: OrganizationSettings) => void;
  canEdit: boolean;
}

export function GeneralSettingsForm({ settings, onUpdate, canEdit }: GeneralSettingsFormProps) {
  const t = useTranslations("settings.general");
  const commonT = useTranslations("common");
  const [name, setName] = useState(settings.name);
  const [primaryDomain, setPrimaryDomain] = useState(settings.primary_domain);
  const [language, setLanguage] = useState(settings.default_language);
  const [isSaving, setIsSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  async function handleSave() {
    setIsSaving(true);
    try {
      const updated = await updateGeneralSettings({
        name,
        primary_domain: primaryDomain,
        default_language: language,
      });
      onUpdate(updated);
      setSavedAt(Date.now());
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="bg-surface rounded-xl border border-outline-variant p-6 space-y-6 max-w-2xl">
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

      <Combobox
        label={t("languageLabel")}
        options={LANGUAGE_OPTIONS}
        value={language}
        onChange={canEdit ? setLanguage : () => {}}
      />

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
  );
}
