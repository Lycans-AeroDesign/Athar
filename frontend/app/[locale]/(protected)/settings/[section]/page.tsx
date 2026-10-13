"use client";

import { useTranslations } from "next-intl";
import { use, useEffect } from "react";

import { InventoryListManager } from "@/components/engineering/InventoryListManager";
import { AuditLogSettingsForm } from "@/components/settings/AuditLogSettingsForm";
import { BackupsSettingsForm } from "@/components/settings/BackupsSettingsForm";
import { CategorySettingsForm } from "@/components/settings/CategorySettingsForm";
import { FeaturesSettingsForm } from "@/components/settings/FeaturesSettingsForm";
import { IdentitySettingsForm } from "@/components/settings/IdentitySettingsForm";
import { InvitationsSettingsForm } from "@/components/settings/InvitationsSettingsForm";
import { PoliciesSettingsForm } from "@/components/settings/PoliciesSettingsForm";
import { RolesSettingsForm } from "@/components/settings/RolesSettingsForm";
import { useSettingsPermissions, useVisibleSettingsGroups } from "@/components/settings/sections";
import { useReportSettingsDirty } from "@/components/settings/SettingsShell";
import { UsersSettingsForm } from "@/components/settings/UsersSettingsForm";
import { CourseCategoryManager } from "@/components/training/CourseCategoryManager";
import { useRouter } from "@/i18n/navigation";
import { useOrganization } from "@/lib/organization/OrganizationProvider";

export default function SettingsSectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = use(params);
  const commonT = useTranslations("common");
  const router = useRouter();
  const { settings, setSettings } = useOrganization();
  const reportDirty = useReportSettingsDirty();
  const permissions = useSettingsPermissions();
  const isAllowed = useVisibleSettingsGroups().some((group) => group.sections.some((s) => s.id === section));

  // An unknown section, or one this viewer's role can't open (e.g. a stale
  // bookmark after a role change) - back to /settings, which forwards to
  // the first section they *can* open.
  useEffect(() => {
    if (!isAllowed) router.replace("/settings");
  }, [isAllowed, router]);

  if (!isAllowed) return null;

  switch (section) {
    case "identity":
    case "features":
      if (!settings) {
        return <p className="font-body-md text-body-md text-on-surface-variant">{commonT("loading")}</p>;
      }
      return section === "identity" ? (
        <IdentitySettingsForm
          settings={settings}
          onUpdate={setSettings}
          canEditName={permissions.canEditGeneral}
          canEditBranding={permissions.canEditBranding}
          onDirtyChange={reportDirty}
        />
      ) : (
        <FeaturesSettingsForm
          settings={settings}
          onUpdate={setSettings}
          canEdit={permissions.canEditGeneral}
          onDirtyChange={reportDirty}
        />
      );
    case "users":
      return <UsersSettingsForm />;
    case "invitations":
      return <InvitationsSettingsForm />;
    case "roles":
      return <RolesSettingsForm />;
    case "categories":
      return (
        <div className="space-y-8">
          {permissions.canManageCategories && <CategorySettingsForm />}
          {/* Components' own categories and storage locations - separate
              lists from the knowledge categories above (see
              backend/knowledge/models.py's ComponentCategory), gated on the
              same category.manage permission. */}
          {permissions.canManageCategories && <InventoryListManager kind="categories" />}
          {permissions.canManageCategories && <InventoryListManager kind="locations" />}
          {permissions.canManageTrainingCategories && <CourseCategoryManager />}
        </div>
      );
    case "policies":
      return <PoliciesSettingsForm />;
    case "audit":
      return <AuditLogSettingsForm />;
    case "backups":
      return <BackupsSettingsForm />;
    default:
      return null;
  }
}
