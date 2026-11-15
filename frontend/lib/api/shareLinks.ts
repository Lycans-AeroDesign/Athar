// Read-only public links to articles and SOPs - see backend/knowledge/sharing.py.

import { apiJson, apiUrl } from "./client";
import type { Paginated, PublicShare, ShareableType, ShareLinkEntry } from "./types";

export function getShareLinks(
  filter: { type?: ShareableType; objectId?: string; includeInactive?: boolean; page?: number } = {},
): Promise<Paginated<ShareLinkEntry>> {
  const params = new URLSearchParams({ page: String(filter.page ?? 1) });
  if (filter.type) params.set("type", filter.type);
  if (filter.objectId) params.set("object_id", filter.objectId);
  if (filter.includeInactive) params.set("include_inactive", "true");
  return apiJson<Paginated<ShareLinkEntry>>(`/api/v1/knowledge/share-links/?${params.toString()}`);
}

export function createShareLink(payload: {
  type: ShareableType;
  object_id: string;
  label?: string;
  /** null = never expires. */
  expires_in_days: number | null;
}): Promise<ShareLinkEntry> {
  return apiJson<ShareLinkEntry>("/api/v1/knowledge/share-links/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function revokeShareLink(id: string): Promise<ShareLinkEntry> {
  return apiJson<ShareLinkEntry>(`/api/v1/knowledge/share-links/${id}/revoke/`, { method: "POST" });
}

/** The link to hand out (this site's /s/<token> page, in the viewer's locale). */
export function publicShareUrl(token: string, locale: string): string {
  return `${window.location.origin}/${locale}/s/${token}`;
}

/** No login: a plain fetch, not apiJson (which would try to refresh a session). */
export async function getPublicShare(token: string): Promise<PublicShare | null> {
  const response = await fetch(apiUrl(`/api/v1/public/shares/${encodeURIComponent(token)}/`), {
    credentials: "omit",
    cache: "no-store",
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Share request failed (${response.status})`);
  return response.json() as Promise<PublicShare>;
}

export function publicShareFileUrl(token: string, fileId: string, size?: "sm" | "md"): string {
  const query = size ? `?size=${size}` : "";
  return apiUrl(`/api/v1/public/shares/${encodeURIComponent(token)}/files/${fileId}/${query}`);
}
