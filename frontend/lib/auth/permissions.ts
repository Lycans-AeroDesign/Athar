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

/** Reads the current user's `engineering_list_filters` preference (Settings > General >
 * Preferences toggle) - governs both the Projects/Components/Failures/SOPs list pages'
 * own search box and GlobalSearch's auto-scoping to the current section. Defaults to on
 * (undefined/logged-out reads as enabled) so the feature is opt-out, not opt-in. */
export function useEngineeringListFiltersEnabled(): boolean {
  const { user } = useAuth();
  return user?.preferences.engineering_list_filters ?? true;
}
