import { useHasPermission } from "@/lib/auth/permissions";

export type SettingsSectionId =
  "identity" | "features" | "users" | "invitations" | "roles" | "categories" | "policies" | "audit" | "backups";

export type SettingsGroupId = "organization" | "people" | "content" | "data";

export interface SettingsSection {
  id: SettingsSectionId;
  icon: string;
}

export interface SettingsGroup {
  id: SettingsGroupId;
  sections: SettingsSection[];
}

// Display order for the Settings side nav - each section is its own route
// (/settings/<id>, see app/[locale]/(protected)/settings/[section]/page.tsx).
// The Stitch reference (ref/athar_general_settings) also shows
// Authentication/Teams/Visibility/Notifications/Storage, but those aren't
// wired to a real backend yet, so they're left out rather than shown as
// non-functional placeholders.
const GROUPS: SettingsGroup[] = [
  {
    id: "organization",
    sections: [
      { id: "identity", icon: "domain" },
      { id: "features", icon: "auto_awesome" },
    ],
  },
  {
    id: "people",
    sections: [
      { id: "users", icon: "group" },
      { id: "invitations", icon: "mail" },
      { id: "roles", icon: "admin_panel_settings" },
    ],
  },
  {
    id: "content",
    sections: [
      { id: "categories", icon: "label" },
      { id: "policies", icon: "gavel" },
    ],
  },
  {
    id: "data",
    sections: [
      { id: "audit", icon: "checklist" },
      { id: "backups", icon: "archive" },
    ],
  },
];

/** Every permission the Settings sections gate on, resolved once. UX-only -
 * each section's own API endpoints are the real boundary. */
export function useSettingsPermissions() {
  const canEditGeneral = useHasPermission("organization.manage");
  const canEditBranding = useHasPermission("branding.manage");
  // GET /knowledge/categories/ needs no special permission, but create/delete
  // do (see CategorySettingsForm's own top comment) - without category.manage
  // the section would only ever show a read-only list, so it's hidden instead.
  const canManageCategories = useHasPermission("category.manage");
  // Training's own CourseCategory is a separate model from Knowledge's
  // Category (see CourseCategoryManager's top comment) - gated on the same
  // training.manage permission that guards its create/delete endpoints and
  // its other management UI at /training/manage.
  const canManageTrainingCategories = useHasPermission("training.manage");
  // GET /rbac/roles/ itself requires role.manage, so without it there is
  // nothing this section could show - see RolesSettingsForm's own top comment.
  const canManageRoles = useHasPermission("role.manage");
  // GET /auth/invitations/ and GET /rbac/users/ both require user.manage -
  // same permission the Users section's block/unblock action requires.
  const canManageUsers = useHasPermission("user.manage");
  // GET /audit/logs/ itself requires audit.read.
  const canReadAudit = useHasPermission("audit.read");

  return {
    canEditGeneral,
    canEditBranding,
    canManageCategories,
    canManageTrainingCategories,
    canManageRoles,
    canManageUsers,
    canReadAudit,
  };
}

type SettingsPermissions = ReturnType<typeof useSettingsPermissions>;

function isSectionVisible(id: SettingsSectionId, p: SettingsPermissions): boolean {
  switch (id) {
    case "identity":
      return p.canEditGeneral || p.canEditBranding;
    // Features, Policies, and Backups all sit behind organization.manage -
    // "who administers this org" (the /policies/manage/ and /backups/
    // endpoints require it too).
    case "features":
    case "policies":
    case "backups":
      return p.canEditGeneral;
    case "users":
    case "invitations":
      return p.canManageUsers;
    case "roles":
      return p.canManageRoles;
    case "categories":
      return p.canManageCategories || p.canManageTrainingCategories;
    case "audit":
      return p.canReadAudit;
  }
}

/** The groups/sections this viewer can open, with empty groups dropped. */
export function useVisibleSettingsGroups(): SettingsGroup[] {
  const permissions = useSettingsPermissions();
  return GROUPS.map((group) => ({
    ...group,
    sections: group.sections.filter((section) => isSectionVisible(section.id, permissions)),
  })).filter((group) => group.sections.length > 0);
}
