// A user's personal "save for later" on any relatable content type - see
// backend/knowledge/models.py's Bookmark and serializers.py's
// BookmarkSerializer/CreateBookmarkSerializer.

import { apiJson, apiVoid } from "./client";
import type { BookmarkEntry, Paginated, RelatableType } from "./types";

export function getBookmarks(type?: RelatableType, page = 1): Promise<Paginated<BookmarkEntry>> {
  const params = new URLSearchParams({ page: String(page) });
  if (type) params.set("type", type);
  return apiJson<Paginated<BookmarkEntry>>(`/api/v1/knowledge/bookmarks/?${params.toString()}`);
}

export function createBookmark(type: RelatableType, objectId: string): Promise<BookmarkEntry> {
  return apiJson<BookmarkEntry>("/api/v1/knowledge/bookmarks/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content_type: type, object_id: objectId }),
  });
}

export function deleteBookmark(id: string): Promise<void> {
  return apiVoid(`/api/v1/knowledge/bookmarks/${id}/`, { method: "DELETE" });
}
