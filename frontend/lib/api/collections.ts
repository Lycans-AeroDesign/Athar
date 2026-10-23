import { apiJson, apiVoid } from "./client";
import type { CollectionContext, CollectionDetail, CollectionItemRef, CollectionSummary } from "./types";

// Wraps /api/v1/knowledge/collections/ (see backend/knowledge/views.py's
// Collection*View classes). Creating/editing/reordering requires the
// collection.manage permission (Mentor+); reading needs none beyond login.

export interface CollectionWritePayload {
  title?: string;
  description?: string;
  mode?: "SERIES" | "FOLDER";
  content_scope?: "SOP" | "ARTICLE" | "MIXED";
  visibility?: "PUBLIC" | "RESTRICTED";
  category_id?: string | null;
  tag_names?: string[];
}

export interface AddCollectionItemPayload {
  content_type: string;
  object_id: string;
  /** Insert position; omitted appends at the end. */
  order?: number;
  phase_title?: string;
  note?: string;
}

export function getCollections(filters?: {
  mode?: "SERIES" | "FOLDER";
  scope?: "SOP" | "ARTICLE" | "MIXED";
  category?: string;
  q?: string;
  page?: number;
  /** Ask for a bigger single page (backend caps at max_page_size=100). */
  page_size?: number;
}): Promise<{ count: number; next: string | null; results: CollectionSummary[] }> {
  const params = new URLSearchParams();
  if (filters?.mode) params.set("mode", filters.mode);
  if (filters?.scope) params.set("scope", filters.scope);
  if (filters?.category) params.set("category", filters.category);
  if (filters?.q) params.set("q", filters.q);
  if (filters?.page) params.set("page", String(filters.page));
  if (filters?.page_size) params.set("page_size", String(filters.page_size));
  const query = params.toString() ? `?${params.toString()}` : "";
  return apiJson(`/api/v1/knowledge/collections/${query}`);
}

export function getCollection(id: string): Promise<CollectionDetail> {
  return apiJson(`/api/v1/knowledge/collections/${id}/`);
}

export function createCollection(payload: CollectionWritePayload): Promise<CollectionDetail> {
  return apiJson("/api/v1/knowledge/collections/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function updateCollection(id: string, payload: CollectionWritePayload): Promise<CollectionDetail> {
  return apiJson(`/api/v1/knowledge/collections/${id}/`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function deleteCollection(id: string): Promise<void> {
  return apiVoid(`/api/v1/knowledge/collections/${id}/`, { method: "DELETE" });
}

export function addCollectionItem(collectionId: string, payload: AddCollectionItemPayload): Promise<CollectionItemRef> {
  return apiJson(`/api/v1/knowledge/collections/${collectionId}/items/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function updateCollectionItem(
  collectionId: string,
  itemId: string,
  payload: { phase_title?: string; note?: string; order?: number },
): Promise<CollectionItemRef> {
  return apiJson(`/api/v1/knowledge/collections/${collectionId}/items/${itemId}/`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function removeCollectionItem(collectionId: string, itemId: string): Promise<void> {
  return apiVoid(`/api/v1/knowledge/collections/${collectionId}/items/${itemId}/`, { method: "DELETE" });
}

/** Sends the complete item list in the wanted order (the backend renumbers
 * `order` to match); returns the refreshed, viewer-scoped collection. */
export function reorderCollectionItems(collectionId: string, itemIds: string[]): Promise<CollectionDetail> {
  return apiJson(`/api/v1/knowledge/collections/${collectionId}/reorder/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ item_ids: itemIds }),
  });
}

/** Collections a SOP/article list page (or its editor picker) should show:
 * exactly-scoped rows plus MIXED ones, fetched side by side since the
 * backend's ?scope= filter is exact-match (CollectionListView.get). */
export async function getCollectionsIncludingMixed(
  scope: "SOP" | "ARTICLE",
): Promise<CollectionSummary[]> {
  const [exact, mixed] = await Promise.all([
    getCollections({ scope }),
    getCollections({ scope: "MIXED", page_size: 100 }),
  ]);
  const byId = new Map<string, CollectionSummary>();
  for (const collection of [...exact.results, ...mixed.results]) byId.set(collection.id, collection);
  return [...byId.values()];
}

/** Applies a picker's membership diff for one SOP/article: adds it to the
 * newly-picked collections and removes it from the deselected ones (whose
 * membership row is looked up by content id, since the detail-page context
 * carries positions, not item ids). Caller needs collection.manage. */
export async function syncCollectionMembership(
  itemType: string,
  itemId: string,
  initial: CollectionContext[],
  selectedIds: string[],
): Promise<void> {
  const initialIds = new Set(initial.map((c) => c.id));
  const selected = new Set(selectedIds);
  for (const collectionId of selectedIds) {
    if (!initialIds.has(collectionId)) {
      await addCollectionItem(collectionId, { content_type: itemType, object_id: itemId });
    }
  }
  for (const context of initial) {
    if (selected.has(context.id)) continue;
    const detail = await getCollection(context.id);
    const membership = detail.items.find((item) => item.content?.id === itemId);
    if (membership) await removeCollectionItem(context.id, membership.id);
  }
}
