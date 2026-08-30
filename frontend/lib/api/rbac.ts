import { apiJson, apiVoid } from "./client";
import type { Permission, Role, User } from "./types";

export function getRoles(): Promise<Role[]> {
  return apiJson<Role[]>("/api/v1/rbac/roles/");
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
  return apiJson<Permission[]>("/api/v1/rbac/permissions/");
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
  return apiJson<User[]>("/api/v1/rbac/users/");
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
