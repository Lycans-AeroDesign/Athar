"use client";

import { useAuth } from "./AuthProvider";

/**
 * UX gating only, not access control - the corresponding view's
 * `require_permission(codename)` on the backend is the real boundary (see
 * CONTRIBUTING.md "Permission gating"). `codename` undefined means "no
 * permission required", so optional per-item checks (e.g. a nav item with no
 * `permission` field) don't need a separate branch at the call site.
 */
export function useHasPermission(codename?: string): boolean {
  const { user } = useAuth();
  if (!codename) return true;
  return user?.permissions.includes(codename) ?? false;
}
