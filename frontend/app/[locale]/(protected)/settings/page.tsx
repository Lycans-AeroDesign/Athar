"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { BrandingSettingsForm } from "@/components/settings/BrandingSettingsForm";
import { CategorySettingsForm } from "@/components/settings/CategorySettingsForm";
import { GeneralSettingsForm } from "@/components/settings/GeneralSettingsForm";
import { RolesSettingsForm } from "@/components/settings/RolesSettingsForm";
import { useHasPermission } from "@/lib/auth/permissions";
import { useOrganization } from "@/lib/organization/OrganizationProvider";

// Only General, Branding, Categories, and Roles & Permissions are
// implemented - the Stitch reference (ref/aerokms_general_settings) also
// shows Authentication/Teams/Visibility/Notifications/Storage tabs, but
// those aren't wired to a real backend yet, so they're left out rather than
// shown as non-functional placeholders.
const ALL_TAB_IDS = ["general", "branding", "categories", "permissions"] as const;
type TabId = (typeof ALL_TAB_IDS)[number];

export default function SettingsPage() {
  const { settings, setSettings } = useOrganization();
  const [activeTab, setActiveTab] = useState<TabId>("general");
  const t = useTranslations("settings");
  const commonT = useTranslations("common");

  const canEditGeneral = useHasPermission("organization.manage");
  const canEditBranding = useHasPermission("branding.manage");
  // GET /knowledge/categories/ needs no special permission, but create/delete
  // do (see CategorySettingsForm's own top comment) - without category.manage
  // the tab would only ever show a read-only list, so it's hidden instead.
  const canManageCategories = useHasPermission("category.manage");
  // GET /rbac/roles/ itself requires role.manage, so without it there is
  // nothing this tab could show - see RolesSettingsForm's own top comment.
  const canManageRoles = useHasPermission("role.manage");

  const visibleTabs = ALL_TAB_IDS.filter(
    (tabId) =>
      (tabId !== "permissions" || canManageRoles) && (tabId !== "categories" || canManageCategories),
  );

  return (
    <section>
      <h1 className="font-display text-display text-on-surface">{t("title")}</h1>
      <p className="font-body-lg text-body-lg text-on-surface-variant mt-2">{t("description")}</p>

      <div className="flex gap-6 border-b border-outline-variant mt-6 mb-6">
        {visibleTabs.map((tabId) => (
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

      {activeTab === "permissions" ? (
        <RolesSettingsForm />
      ) : activeTab === "categories" ? (
        <CategorySettingsForm />
      ) : !settings ? (
        <p className="font-body-md text-body-md text-on-surface-variant">{commonT("loading")}</p>
      ) : activeTab === "general" ? (
        <GeneralSettingsForm settings={settings} onUpdate={setSettings} canEdit={canEditGeneral} />
      ) : (
        <BrandingSettingsForm settings={settings} onUpdate={setSettings} canEdit={canEditBranding} />
      )}
    </section>
  );
}
