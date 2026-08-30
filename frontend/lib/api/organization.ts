import { apiJson } from "./client";
import type { OrganizationSettings, StoredFileRef } from "./types";

export function getOrganizationSettings(): Promise<OrganizationSettings> {
  return apiJson<OrganizationSettings>("/api/v1/organization/settings/");
}

export function updateGeneralSettings(payload: {
  name?: string;
  primary_domain?: string;
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
  primary_color_dark?: string;
  secondary_color_dark?: string;
}): Promise<OrganizationSettings> {
  return apiJson<OrganizationSettings>("/api/v1/organization/settings/branding/", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function uploadFile(file: File, requiredPermission = "file.read"): Promise<StoredFileRef> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("required_permission", requiredPermission);
  // No Content-Type header - the browser sets the multipart boundary itself.
  // apiJson's error handling already covers DRF's {"file": ["message"]}
  // shape (see files/serializers.py's validate_file, e.g. the size-limit
  // check), so no need to duplicate that extraction here.
  return apiJson<StoredFileRef>("/api/v1/files/upload/", { method: "POST", body: formData });
}
