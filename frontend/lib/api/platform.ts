import { apiJson } from "./client";
import type { PasswordResetLink } from "./passwordReset";
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

export function createPlatformPasswordResetLink(id: string): Promise<PasswordResetLink> {
  return apiJson<PasswordResetLink>(`/api/v1/platform/users/${id}/password-reset-link/`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ send_email: false }),
  });
}
