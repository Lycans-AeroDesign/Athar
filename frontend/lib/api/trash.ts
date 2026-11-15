// Deleted articles/questions waiting out the retention period - see
// backend/knowledge/trash.py.

import { apiJson, apiVoid } from "./client";
import type { Paginated, TrashedItem, TrashType } from "./types";

export function getTrash(type?: TrashType, page = 1): Promise<Paginated<TrashedItem>> {
  const params = new URLSearchParams({ page: String(page) });
  if (type) params.set("type", type);
  return apiJson<Paginated<TrashedItem>>(`/api/v1/knowledge/trash/?${params.toString()}`);
}

export function restoreFromTrash(type: TrashType, id: string): Promise<{ type: TrashType; id: string }> {
  return apiJson(`/api/v1/knowledge/trash/${type}/${id}/restore/`, { method: "POST" });
}

/** Permanent - needs trash.purge. */
export function purgeFromTrash(type: TrashType, id: string): Promise<void> {
  return apiVoid(`/api/v1/knowledge/trash/${type}/${id}/`, { method: "DELETE" });
}
