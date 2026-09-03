import { apiJson, apiVoid } from "./client";
import type { Paginated, Permission, Role, User } from "./types";

// See knowledge.ts's top-of-file note - these unwrap the paginated envelope
// and return page 1 (20 items) as a bare array for now; RolesSettingsForm's
// "load more" pagination lands separately.
export function getRoles(): Promise<Role[]> {
  return apiJson<Paginated<Role>>("/api/v1/rbac/roles/").then((data) => data.results);
}

export function createRole(payload: { name: string; description?: string }): Promise<Role> {
  return apiJson<Role>("/api/v1/rbac/roles/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function deleteRole(roleId: string): Promise<void> {
  return apiVoid(`/api/v1/rbac/roles/${roleId}/`, { method: "DELETE" });
}

export function getPermissions(): Promise<Permission[]> {
  return apiJson<Paginated<Permission>>("/api/v1/rbac/permissions/").then((data) => data.results);
}

export function grantPermission(roleId: string, permissionId: string): Promise<Permission[]> {
  return apiJson<Permission[]>(`/api/v1/rbac/roles/${roleId}/permissions/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ permission_id: permissionId }),
  });
}

export function revokePermission(roleId: string, permissionId: string): Promise<void> {
  return apiVoid(`/api/v1/rbac/roles/${roleId}/permissions/${permissionId}/`, { method: "DELETE" });
}

export function getUsers(): Promise<User[]> {
  return apiJson<Paginated<User>>("/api/v1/rbac/users/").then((data) => data.results);
}

export function assignRole(userId: string, roleId: string): Promise<void> {
  return apiVoid(`/api/v1/rbac/users/${userId}/roles/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role_id: roleId }),
  });
}

export function unassignRole(userId: string, roleId: string): Promise<void> {
  return apiVoid(`/api/v1/rbac/users/${userId}/roles/${roleId}/`, { method: "DELETE" });
}

/** Block (is_active: false) or unblock (true) a user - requires user.manage, and never targets
 * your own account (see rbac.services.set_user_active) or a user in another organization. */
export function setUserActive(userId: string, isActive: boolean): Promise<User> {
  return apiJson<User>(`/api/v1/rbac/users/${userId}/active/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ is_active: isActive }),
  });
}
