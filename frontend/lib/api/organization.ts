import { apiJson } from "./client";
import type { OrganizationSettings } from "./types";

export function getOrganizationSettings(): Promise<OrganizationSettings> {
  return apiJson<OrganizationSettings>("/api/v1/organization/settings/");
}

export function updateGeneralSettings(payload: {
  name?: string;
  product_tour_enabled?: boolean;
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
