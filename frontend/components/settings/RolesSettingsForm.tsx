"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Combobox } from "@/components/ui/Combobox";
import { Icon } from "@/components/ui/Icon";
import { Modal } from "@/components/ui/Modal";
import { useHasPermission } from "@/lib/auth/permissions";
import {
  assignRole,
  createRole,
  deleteRole,
  getPermissions,
  getRoles,
  getUsers,
  grantPermission,
  revokePermission,
  unassignRole,
} from "@/lib/api/rbac";
import type { Permission, Role, User } from "@/lib/api/types";

// A role plus whatever local edits haven't been committed to the backend yet
// - nothing in this component calls the API until "Save Changes", so every
// grant/revoke/assign/unassign/create/delete is staged here first. Permission
// and user *membership* is tracked as pending add/remove diffs against the
// last-saved state (rather than mutating `permissions` in place) so a removed
// item can still be shown - struck through, with an Undo - until it's saved.
interface DraftRole {
  id: string;
  isNew: boolean;
  isDeleted: boolean;
  name: string;
  description: string;
  is_system: boolean;
  permissions: Permission[];
  pendingGrants: Permission[];
  pendingRevokes: Permission[];
  pendingAssignUserIds: string[];
  pendingUnassignUserIds: string[];
}

function roleToDraft(role: Role): DraftRole {
  return {
    id: role.id,
    isNew: false,
    isDeleted: false,
    name: role.name,
    description: role.description,
    is_system: role.is_system,
    permissions: role.permissions,
    pendingGrants: [],
    pendingRevokes: [],
    pendingAssignUserIds: [],
    pendingUnassignUserIds: [],
  };
}

function isRoleDirty(role: DraftRole): boolean {
  return (
    role.isNew ||
    role.isDeleted ||
    role.pendingGrants.length > 0 ||
    role.pendingRevokes.length > 0 ||
    role.pendingAssignUserIds.length > 0 ||
    role.pendingUnassignUserIds.length > 0
  );
}

// Rendered only when the viewer has role.manage (see settings/page.tsx) -
// that's also what GET /rbac/roles/ itself requires, so there's nothing to
// show here without it. permission.manage and user.manage are checked
// separately below since either can be held independently of role.manage.
export function RolesSettingsForm() {
  const t = useTranslations("settings.permissions");
  const commonT = useTranslations("common");
  const canManagePermissions = useHasPermission("permission.manage");
  const canManageUserRoles = useHasPermission("user.manage");

  const [roles, setRoles] = useState<Role[] | null>(null);
  const [draftRoles, setDraftRoles] = useState<DraftRole[]>([]);
  const [permissionCatalogue, setPermissionCatalogue] = useState<Permission[] | null>(null);
  const [users, setUsers] = useState<User[] | null>(null);
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [newRoleName, setNewRoleName] = useState("");
  const [newRoleDescription, setNewRoleDescription] = useState("");

  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    getRoles().then((data) => {
      setRoles(data);
      setDraftRoles(data.map(roleToDraft));
    });
  }, []);

  useEffect(() => {
    if (canManagePermissions) getPermissions().then(setPermissionCatalogue);
  }, [canManagePermissions]);

  useEffect(() => {
    if (canManageUserRoles) getUsers().then(setUsers);
  }, [canManageUserRoles]);

  const selectedRole = draftRoles.find((role) => role.id === selectedRoleId) ?? null;
  const isDirty = draftRoles.some(isRoleDirty);

  function updateSelectedRole(updater: (role: DraftRole) => DraftRole) {
    if (!selectedRole) return;
    setDraftRoles((prev) => prev.map((r) => (r.id === selectedRole.id ? updater(r) : r)));
  }

  function handleStageNewRole() {
    const draft: DraftRole = {
      id: `new:${crypto.randomUUID()}`,
      isNew: true,
      isDeleted: false,
      name: newRoleName.trim(),
      description: newRoleDescription.trim(),
      is_system: false,
      permissions: [],
      pendingGrants: [],
      pendingRevokes: [],
      pendingAssignUserIds: [],
      pendingUnassignUserIds: [],
    };
    setDraftRoles((prev) => [...prev, draft]);
    setSelectedRoleId(draft.id);
    setCreateOpen(false);
    setNewRoleName("");
    setNewRoleDescription("");
  }

  function handleToggleDeleteRole(role: DraftRole) {
    if (role.isNew) {
      setDraftRoles((prev) => prev.filter((r) => r.id !== role.id));
      if (selectedRoleId === role.id) setSelectedRoleId(null);
      return;
    }
    setDraftRoles((prev) =>
      prev.map((r) => (r.id === role.id ? { ...r, isDeleted: !r.isDeleted } : r)),
    );
  }

  function handleGrantPermission(permissionId: string) {
    const permission = permissionCatalogue?.find((p) => p.id === permissionId);
    if (!permission) return;
    updateSelectedRole((r) => ({ ...r, pendingGrants: [...r.pendingGrants, permission] }));
  }

  function handleRevokePermission(permission: Permission) {
    updateSelectedRole((r) => {
      if (r.pendingGrants.some((p) => p.id === permission.id)) {
        return { ...r, pendingGrants: r.pendingGrants.filter((p) => p.id !== permission.id) };
      }
      return { ...r, pendingRevokes: [...r.pendingRevokes, permission] };
    });
  }

  function handleUndoRevokePermission(permission: Permission) {
    updateSelectedRole((r) => ({
      ...r,
      pendingRevokes: r.pendingRevokes.filter((p) => p.id !== permission.id),
    }));
  }

  function handleAssignUser(userId: string) {
    updateSelectedRole((r) => {
      if (r.pendingUnassignUserIds.includes(userId)) {
        return { ...r, pendingUnassignUserIds: r.pendingUnassignUserIds.filter((id) => id !== userId) };
      }
      return { ...r, pendingAssignUserIds: [...r.pendingAssignUserIds, userId] };
    });
  }

  function handleUnassignUser(userId: string) {
    updateSelectedRole((r) => {
      if (r.pendingAssignUserIds.includes(userId)) {
        return { ...r, pendingAssignUserIds: r.pendingAssignUserIds.filter((id) => id !== userId) };
      }
      return { ...r, pendingUnassignUserIds: [...r.pendingUnassignUserIds, userId] };
    });
  }

  function handleUndoUnassignUser(userId: string) {
    updateSelectedRole((r) => ({
      ...r,
      pendingUnassignUserIds: r.pendingUnassignUserIds.filter((id) => id !== userId),
    }));
  }

  function handleDiscardChanges() {
    setDraftRoles((roles ?? []).map(roleToDraft));
    setSaveError(null);
    setSelectedRoleId((current) => (current && roles?.some((r) => r.id === current) ? current : null));
  }

  async function handleSaveChanges() {
    setIsSaving(true);
    setSaveError(null);
    try {
      for (const draft of draftRoles) {
        if (draft.isDeleted) {
          await deleteRole(draft.id);
          continue;
        }

        let roleId = draft.id;
        if (draft.isNew) {
          const created = await createRole({ name: draft.name, description: draft.description });
          roleId = created.id;
        }

        for (const permission of draft.pendingGrants) {
          await grantPermission(roleId, permission.id);
        }
        for (const permission of draft.pendingRevokes) {
          await revokePermission(roleId, permission.id);
        }
        for (const userId of draft.pendingAssignUserIds) {
          await assignRole(userId, roleId);
        }
        for (const userId of draft.pendingUnassignUserIds) {
          await unassignRole(userId, roleId);
        }
      }

      const [freshRoles, freshUsers] = await Promise.all([
        getRoles(),
        canManageUserRoles ? getUsers() : Promise.resolve(users),
      ]);
      setRoles(freshRoles);
      setDraftRoles(freshRoles.map(roleToDraft));
      if (canManageUserRoles) setUsers(freshUsers);
      setSelectedRoleId((current) => (current && freshRoles.some((r) => r.id === current) ? current : null));
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSaving(false);
    }
  }

  const grantedPermissions = selectedRole?.permissions ?? [];
  const pendingRevokeIds = new Set(selectedRole?.pendingRevokes.map((p) => p.id) ?? []);
  const pendingGrantIds = new Set(selectedRole?.pendingGrants.map((p) => p.id) ?? []);
  const effectivePermissions = selectedRole
    ? [
        ...grantedPermissions.map((permission) => ({
          permission,
          pending: pendingRevokeIds.has(permission.id) ? ("remove" as const) : null,
        })),
        ...selectedRole.pendingGrants.map((permission) => ({ permission, pending: "add" as const })),
      ]
    : [];
  const grantablePermissions =
    permissionCatalogue?.filter(
      (p) => !grantedPermissions.some((g) => g.id === p.id) && !pendingGrantIds.has(p.id),
    ) ?? [];

  const committedUserIds = new Set(
    (users ?? []).filter((u) => selectedRole && u.roles.includes(selectedRole.name)).map((u) => u.id),
  );
  const effectiveUsers = selectedRole
    ? [
        ...(users ?? [])
          .filter((u) => committedUserIds.has(u.id))
          .map((u) => ({
            user: u,
            pending: selectedRole.pendingUnassignUserIds.includes(u.id) ? ("remove" as const) : null,
          })),
        ...(users ?? [])
          .filter((u) => selectedRole.pendingAssignUserIds.includes(u.id))
          .map((u) => ({ user: u, pending: "add" as const })),
      ]
    : [];
  const assignableUsers =
    users?.filter(
      (u) => !committedUserIds.has(u.id) && !selectedRole?.pendingAssignUserIds.includes(u.id),
    ) ?? [];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6 items-start">
        <div className="bg-surface rounded-xl border border-outline-variant p-4 space-y-2">
          <div className="flex items-center justify-between px-2 pb-2">
            <h2 className="font-headline-md text-headline-md text-on-surface">{t("title")}</h2>
          </div>

          {!roles ? (
            <p className="font-body-md text-body-md text-on-surface-variant px-2">{t("description")}</p>
          ) : (
            <div className="space-y-1">
              {draftRoles.map((role) => (
                <button
                  key={role.id}
                  type="button"
                  onClick={() => setSelectedRoleId(role.id)}
                  className={`flex items-center justify-between w-full px-3 py-2 rounded-lg font-body-md text-body-md text-left transition-colors ${
                    role.id === selectedRoleId
                      ? "bg-secondary-container text-on-secondary-container"
                      : "text-on-surface hover:bg-surface-variant"
                  } ${role.isDeleted ? "opacity-60" : ""}`}
                >
                  <span className={`truncate ${role.isDeleted ? "line-through" : ""}`}>{role.name}</span>
                  <span className="flex items-center gap-1 shrink-0 ml-2">
                    {role.is_system && (
                      <span className="font-label-caps text-label-caps uppercase text-on-surface-variant bg-surface-variant rounded-full px-2 py-0.5">
                        {t("systemRole")}
                      </span>
                    )}
                    {role.isDeleted ? (
                      <span className="font-label-caps text-label-caps uppercase bg-primary-container text-on-primary-container rounded-full px-2 py-0.5">
                        {t("unsavedRemoving")}
                      </span>
                    ) : role.isNew ? (
                      <span className="font-label-caps text-label-caps uppercase bg-primary-container text-on-primary-container rounded-full px-2 py-0.5">
                        {t("unsavedNew")}
                      </span>
                    ) : (
                      isRoleDirty(role) && (
                        <span className="font-label-caps text-label-caps uppercase bg-primary-container text-on-primary-container rounded-full px-2 py-0.5">
                          {t("unsavedModified")}
                        </span>
                      )
                    )}
                  </span>
                </button>
              ))}
            </div>
          )}

          <Button variant="secondary" className="w-full mt-2" onClick={() => setCreateOpen(true)}>
            <Icon name="add" size={18} />
            {t("newRole")}
          </Button>
        </div>

        <div className="space-y-6">
          {!selectedRole ? (
            <div className="bg-surface rounded-xl border border-outline-variant p-6">
              <p className="font-body-md text-body-md text-on-surface-variant">{t("selectRolePrompt")}</p>
            </div>
          ) : (
            <>
              <div className="bg-surface rounded-xl border border-outline-variant p-6 flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-headline-md text-headline-md text-on-surface">
                      {selectedRole.name}
                    </h3>
                    {selectedRole.isNew && (
                      <span className="font-label-caps text-label-caps uppercase bg-primary-container text-on-primary-container rounded-full px-2 py-0.5">
                        {t("unsavedNew")}
                      </span>
                    )}
                  </div>
                  {selectedRole.description && (
                    <p className="font-body-md text-body-md text-on-surface-variant mt-1">
                      {selectedRole.description}
                    </p>
                  )}
                </div>
                {!selectedRole.is_system &&
                  (selectedRole.isDeleted ? (
                    <Button variant="secondary" onClick={() => handleToggleDeleteRole(selectedRole)}>
                      <Icon name="undo" size={16} />
                      {t("undoDelete")}
                    </Button>
                  ) : (
                    <Button variant="danger" onClick={() => handleToggleDeleteRole(selectedRole)}>
                      {t("deleteRole")}
                    </Button>
                  ))}
              </div>

              {selectedRole.isDeleted && (
                <div className="bg-primary-container text-on-primary-container rounded-xl p-4 font-body-md text-body-md">
                  {t("markedForDeletion")}
                </div>
              )}

              {!selectedRole.isDeleted && canManagePermissions && (
                <div className="bg-surface rounded-xl border border-outline-variant p-6 space-y-4">
                  <h3 className="font-headline-md text-headline-md text-on-surface">
                    {t("permissionsHeading")}
                  </h3>

                  {effectivePermissions.length === 0 ? (
                    <p className="font-body-md text-body-md text-on-surface-variant">
                      {t("noPermissions")}
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {effectivePermissions.map(({ permission, pending }) => (
                        <span
                          key={permission.id}
                          className={`inline-flex items-center gap-2 font-mono-sm text-mono-sm border rounded-full pl-3 pr-1 py-1 ${
                            pending === "add"
                              ? "bg-primary-container text-on-primary-container border-transparent"
                              : pending === "remove"
                                ? "bg-surface-container text-on-surface-variant border-outline-variant line-through opacity-70"
                                : "bg-surface-container text-on-surface border-outline-variant"
                          }`}
                        >
                          {permission.codename}
                          {pending === "remove" ? (
                            <button
                              type="button"
                              onClick={() => handleUndoRevokePermission(permission)}
                              aria-label={t("undo")}
                              className="text-on-surface-variant hover:text-primary transition-colors"
                            >
                              <Icon name="undo" size={14} />
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleRevokePermission(permission)}
                              aria-label={t("removePermission")}
                              // A still-pending grant hasn't been saved yet, so
                              // clicking this just drops the draft - not the
                              // same weight as revoking a permission the role
                              // already has, which gets the red/error hover.
                              className={`text-on-surface-variant transition-colors ${
                                pending === "add" ? "hover:text-on-surface" : "hover:text-error"
                              }`}
                            >
                              <Icon name="close" size={14} />
                            </button>
                          )}
                        </span>
                      ))}
                    </div>
                  )}

                  <Combobox
                    label={t("grantPermission")}
                    options={grantablePermissions.map((p) => ({
                      value: p.id,
                      label: p.description ? `${p.codename} — ${p.description}` : p.codename,
                    }))}
                    value={null}
                    onChange={handleGrantPermission}
                  />
                </div>
              )}

              {!selectedRole.isDeleted && canManageUserRoles && (
                <div className="bg-surface rounded-xl border border-outline-variant p-6 space-y-4">
                  <h3 className="font-headline-md text-headline-md text-on-surface">
                    {t("usersHeading")}
                  </h3>

                  {effectiveUsers.length === 0 ? (
                    <p className="font-body-md text-body-md text-on-surface-variant">{t("noUsers")}</p>
                  ) : (
                    <ul className="space-y-1">
                      {effectiveUsers.map(({ user, pending }) => (
                        <li
                          key={user.id}
                          className={`flex items-center justify-between px-3 py-2 rounded-lg font-body-md text-body-md ${
                            pending === "add"
                              ? "bg-primary-container text-on-primary-container"
                              : pending === "remove"
                                ? "bg-surface-container text-on-surface-variant line-through opacity-70"
                                : "bg-surface-container text-on-surface"
                          }`}
                        >
                          {user.email}
                          {pending === "remove" ? (
                            <button
                              type="button"
                              onClick={() => handleUndoUnassignUser(user.id)}
                              className="font-label-caps text-label-caps uppercase text-on-surface-variant hover:text-primary transition-colors"
                            >
                              {t("undo")}
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleUnassignUser(user.id)}
                              // A still-pending assignment hasn't been saved
                              // yet, so clicking this just drops the draft -
                              // not the same weight as unassigning a user the
                              // role already has, which gets the red/error hover.
                              className={`font-label-caps text-label-caps uppercase text-on-surface-variant transition-colors ${
                                pending === "add" ? "hover:text-on-surface" : "hover:text-error"
                              }`}
                            >
                              {t("removeUser")}
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}

                  <Combobox
                    label={t("assignUser")}
                    options={assignableUsers.map((u) => ({ value: u.id, label: u.email }))}
                    value={null}
                    onChange={handleAssignUser}
                  />
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <div className="flex items-center gap-4">
        <Button variant="secondary" onClick={handleDiscardChanges} disabled={!isDirty || isSaving}>
          {commonT("discard")}
        </Button>
        <Button onClick={handleSaveChanges} disabled={!isDirty || isSaving}>
          {isSaving ? commonT("saving") : commonT("save")}
        </Button>
      </div>
      {saveError && (
        <p className="font-body-md text-body-md text-error" role="alert">
          {saveError}
        </p>
      )}

      <Modal
        open={createOpen}
        onOpenChange={setCreateOpen}
        title={t("newRole")}
        isDirty={newRoleName.length > 0 || newRoleDescription.length > 0}
        footer={
          <Button onClick={handleStageNewRole} disabled={!newRoleName.trim()}>
            {t("createRole")}
          </Button>
        }
      >
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="block font-label-caps text-label-caps text-on-surface-variant uppercase">
              {t("roleNameLabel")}
            </label>
            <input
              className="block w-full px-4 py-2 font-body-md text-body-md text-on-surface bg-surface-container border border-outline-variant rounded-lg focus:ring-1 focus:ring-primary focus:border-primary outline-none transition-colors"
              value={newRoleName}
              onChange={(e) => setNewRoleName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <label className="block font-label-caps text-label-caps text-on-surface-variant uppercase">
              {t("roleDescriptionLabel")}
            </label>
            <input
              className="block w-full px-4 py-2 font-body-md text-body-md text-on-surface bg-surface-container border border-outline-variant rounded-lg focus:ring-1 focus:ring-primary focus:border-primary outline-none transition-colors"
              value={newRoleDescription}
              onChange={(e) => setNewRoleDescription(e.target.value)}
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}
