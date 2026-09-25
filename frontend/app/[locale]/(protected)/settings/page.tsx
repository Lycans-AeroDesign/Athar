"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { AuditLogSettingsForm } from "@/components/settings/AuditLogSettingsForm";
import { BackupsSettingsForm } from "@/components/settings/BackupsSettingsForm";
import { BrandingSettingsForm } from "@/components/settings/BrandingSettingsForm";
import { InventoryListManager } from "@/components/engineering/InventoryListManager";
import { CategorySettingsForm } from "@/components/settings/CategorySettingsForm";
import { GeneralSettingsForm } from "@/components/settings/GeneralSettingsForm";
import { InvitationsSettingsForm } from "@/components/settings/InvitationsSettingsForm";
import { RolesSettingsForm } from "@/components/settings/RolesSettingsForm";
import { UsersSettingsForm } from "@/components/settings/UsersSettingsForm";
import { CourseCategoryManager } from "@/components/training/CourseCategoryManager";
import { useHasPermission } from "@/lib/auth/permissions";
import { useOrganization } from "@/lib/organization/OrganizationProvider";

// Only General, Branding, Categories, Roles & Permissions, Users,
// Invitations, Audit Log, and Backups are implemented - the Stitch reference
// (ref/athar_general_settings) also shows Authentication/Teams/Visibility/
// Notifications/Storage tabs, but those aren't wired to a real backend yet,
// so they're left out rather than shown as non-functional placeholders.
const ALL_TAB_IDS = [
  "general",
  "branding",
  "categories",
  "permissions",
  "users",
  "invitations",
  "audit",
  "backups",
] as const;
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
  // Training's own CourseCategory is a separate model from Knowledge's
  // Category (see CourseCategoryManager's top comment) - gated on the same
  // training.manage permission that guards its create/delete endpoints and
  // its other management UI at /training/manage.
  const canManageTrainingCategories = useHasPermission("training.manage");
  // GET /rbac/roles/ itself requires role.manage, so without it there is
  // nothing this tab could show - see RolesSettingsForm's own top comment.
  const canManageRoles = useHasPermission("role.manage");
  // GET /auth/invitations/ itself requires user.manage - same reasoning as roles above.
  const canManageInvitations = useHasPermission("user.manage");
  // GET /rbac/users/ itself requires user.manage too - same permission the
  // Users tab's block/unblock action requires, so this is also the read gate.
  const canManageUsers = canManageInvitations;
  // GET /audit/logs/ itself requires audit.read - same reasoning as roles above.
  const canReadAudit = useHasPermission("audit.read");
  // GET /backups/ itself requires organization.manage - same reasoning as
  // roles above (and the same permission General's own edit gate uses,
  // since "who can back up this org's data" is exactly "who administers it").
  const canManageBackups = canEditGeneral;

  const visibleTabs = ALL_TAB_IDS.filter(
    (tabId) =>
      (tabId !== "branding" || canEditBranding) &&
      (tabId !== "permissions" || canManageRoles) &&
      (tabId !== "categories" || canManageCategories || canManageTrainingCategories) &&
      (tabId !== "users" || canManageUsers) &&
      (tabId !== "invitations" || canManageInvitations) &&
      (tabId !== "audit" || canReadAudit) &&
      (tabId !== "backups" || canManageBackups),
  );

  return (
    <section>
      <h1 className="font-display text-display text-on-surface">{t("title")}</h1>
      <p className="font-body-lg text-body-lg text-on-surface-variant mt-2">{t("description")}</p>

      <div className="flex gap-6 overflow-x-auto border-b border-outline-variant mt-6 mb-6">
        {visibleTabs.map((tabId) => (
          <button
            key={tabId}
            type="button"
            onClick={() => setActiveTab(tabId)}
            className={`shrink-0 pb-3 font-label-caps text-label-caps uppercase border-b-2 transition-colors -mb-px ${
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
        <div className="space-y-8">
          {canManageCategories && <CategorySettingsForm />}
          {/* Components' own categories and storage locations - separate
              lists from the knowledge categories above (see
              backend/knowledge/models.py's ComponentCategory), gated on the
              same category.manage permission. */}
          {canManageCategories && <InventoryListManager kind="categories" />}
          {canManageCategories && <InventoryListManager kind="locations" />}
          {canManageTrainingCategories && <CourseCategoryManager />}
        </div>
      ) : activeTab === "users" ? (
        <UsersSettingsForm />
      ) : activeTab === "invitations" ? (
        <InvitationsSettingsForm />
      ) : activeTab === "audit" ? (
        <AuditLogSettingsForm />
      ) : activeTab === "backups" ? (
        <BackupsSettingsForm />
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
