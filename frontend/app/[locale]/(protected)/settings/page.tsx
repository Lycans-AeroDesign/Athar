"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { BrandingSettingsForm } from "@/components/settings/BrandingSettingsForm";
import { GeneralSettingsForm } from "@/components/settings/GeneralSettingsForm";
import { useAuth } from "@/lib/auth/AuthProvider";
import { useOrganization } from "@/lib/organization/OrganizationProvider";

// Only General and Branding are implemented - the Stitch reference
// (ref/aerokms_general_settings) also shows Authentication/Teams/Visibility/
// Notifications/Storage/Roles&Permissions tabs, but those aren't wired to a
// real backend yet, so they're left out rather than shown as non-functional
// placeholders. Roles & Permissions is a real feature (backend already
// supports it) but is a separate follow-up given the size of this pass.
const TAB_IDS = ["general", "branding"] as const;
type TabId = (typeof TAB_IDS)[number];

export default function SettingsPage() {
  const { user } = useAuth();
  const { settings, setSettings } = useOrganization();
  const [activeTab, setActiveTab] = useState<TabId>("general");
  const t = useTranslations("settings");
  const commonT = useTranslations("common");

  const canEditGeneral = user?.permissions.includes("organization.manage") ?? false;
  const canEditBranding = user?.permissions.includes("branding.manage") ?? false;

  return (
    <section>
      <h1 className="font-display text-display text-on-surface">{t("title")}</h1>
      <p className="font-body-lg text-body-lg text-on-surface-variant mt-2">{t("description")}</p>

      <div className="flex gap-6 border-b border-outline-variant mt-6 mb-6">
        {TAB_IDS.map((tabId) => (
          <button
            key={tabId}
            type="button"
            onClick={() => setActiveTab(tabId)}
            className={`pb-3 font-label-caps text-label-caps uppercase border-b-2 transition-colors -mb-px ${
              activeTab === tabId
                ? "border-primary text-primary"
                : "border-transparent text-on-surface-variant hover:text-on-surface"
            }`}
          >
            {t(`tabs.${tabId}`)}
          </button>
        ))}
      </div>

      {!settings ? (
        <p className="font-body-md text-body-md text-on-surface-variant">{commonT("loading")}</p>
      ) : activeTab === "general" ? (
        <GeneralSettingsForm settings={settings} onUpdate={setSettings} canEdit={canEditGeneral} />
      ) : (
        <BrandingSettingsForm settings={settings} onUpdate={setSettings} canEdit={canEditBranding} />
      )}
    </section>
  );
}
