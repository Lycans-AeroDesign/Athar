import { apiJson } from "./client";
import type { Paginated } from "./types";

/** Instance-operator (is_superuser) endpoints - administrative metadata only, never org content. */
export interface PlatformSummary {
  organization_count: number;
  active_organization_count: number;
  user_count: number;
  active_user_count: number;
  file_bytes: number;
  backup_bytes: number;
  total_bytes: number;
  /** Space on the filesystem hosting uploads (services.disk_usage). Null when
   * uploads live in object storage instead of the VM's disk. */
  disk_total_bytes: number | null;
  disk_used_bytes: number | null;
  disk_free_bytes: number | null;
}

export interface PlatformContentCounts {
  articles: number;
  questions: number;
  projects: number;
  components: number;
  failures: number;
  sops: number;
  tests: number;
  documents: number;
  courses: number;
}

export interface PlatformOrganization {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
  created_at: string;
  user_count: number;
  active_user_count: number;
  admin_emails: string[];
  file_count: number;
  file_bytes: number;
  backup_bytes: number;
  total_bytes: number;
  last_activity: string | null;
  content_counts: PlatformContentCounts;
}

export interface PlatformUser {
  id: string;
  email: string;
  username: string | null;
  first_name: string;
  last_name: string;
  roles: string[];
  is_active: boolean;
  is_superuser: boolean;
  date_joined: string;
  last_activity: string | null;
}

const JSON_HEADERS = { "Content-Type": "application/json" };

export function getPlatformSummary(): Promise<PlatformSummary> {
  return apiJson<PlatformSummary>("/api/v1/platform/summary/");
}

export function getPlatformOrganizations(page = 1, search = ""): Promise<Paginated<PlatformOrganization>> {
  const query = new URLSearchParams({ page: String(page) });
  if (search) query.set("search", search);
  return apiJson<Paginated<PlatformOrganization>>(`/api/v1/platform/organizations/?${query}`);
}

export function getPlatformOrganization(id: string): Promise<PlatformOrganization> {
  return apiJson<PlatformOrganization>(`/api/v1/platform/organizations/${id}/`);
}

export function getPlatformOrganizationUsers(id: string, page = 1): Promise<Paginated<PlatformUser>> {
  return apiJson<Paginated<PlatformUser>>(`/api/v1/platform/organizations/${id}/users/?page=${page}`);
}

export function setPlatformOrganizationActive(id: string, isActive: boolean): Promise<PlatformOrganization> {
  return apiJson<PlatformOrganization>(`/api/v1/platform/organizations/${id}/active/`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ is_active: isActive }),
  });
}

export function setPlatformUserActive(id: string, isActive: boolean): Promise<PlatformUser> {
  return apiJson<PlatformUser>(`/api/v1/platform/users/${id}/active/`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ is_active: isActive }),
  });
}

/** The backend emails the link to the user and never returns the token (fails with a 400 when
 * email isn't configured on the server). `linkBase` must be on this app's own origin. */
export function sendPlatformPasswordResetLink(
  id: string,
  linkBase: string,
  language: string,
): Promise<{ email: string; expires_at: string; email_sent: boolean }> {
  return apiJson(`/api/v1/platform/users/${id}/password-reset-link/`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ link_base: linkBase, language }),
  });
}

export interface PlatformSettings {
  organization_registration_enabled: boolean;
}

export function getPlatformSettings(): Promise<PlatformSettings> {
  return apiJson<PlatformSettings>("/api/v1/platform/settings/");
}

export function updatePlatformSettings(settings: PlatformSettings): Promise<PlatformSettings> {
  return apiJson<PlatformSettings>("/api/v1/platform/settings/", {
    method: "PATCH",
    headers: JSON_HEADERS,
    body: JSON.stringify(settings),
  });
}
