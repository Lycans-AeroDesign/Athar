import { apiFetch, apiJson } from "./client";
import type { OrganizationSettings, StoredFileRef } from "./types";

export function getOrganizationSettings(): Promise<OrganizationSettings> {
  return apiJson<OrganizationSettings>("/api/v1/organization/settings/");
}

export function updateGeneralSettings(payload: {
  name?: string;
  primary_domain?: string;
  default_language?: string;
}): Promise<OrganizationSettings> {
  return apiJson<OrganizationSettings>("/api/v1/organization/settings/general/", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function updateBrandingSettings(payload: {
  logo_id?: string | null;
  favicon_id?: string | null;
  primary_color?: string;
  secondary_color?: string;
}): Promise<OrganizationSettings> {
  return apiJson<OrganizationSettings>("/api/v1/organization/settings/branding/", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function uploadFile(file: File, requiredPermission = "file.read"): Promise<StoredFileRef> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("required_permission", requiredPermission);
  const res = await apiFetch("/api/v1/files/upload/", { method: "POST", body: formData });
  if (!res.ok) throw new Error(`Upload failed with ${res.status}`);
  return res.json();
}
