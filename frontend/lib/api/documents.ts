// Document/Resource - split out from engineering.ts historically because it
// was the one relatable type besides Article/Question with `visibility`;
// Project/Component/Failure/Sop/Test have it too now (see engineering.ts's
// own Write payloads), but Document's shape otherwise still differs enough
// (draft/review-free but with its own file/url handling) to keep this split.

import { apiJson, apiVoid } from "./client";
import type { DocType, DocumentDetail, DocumentSource, DocumentSummary, Paginated, Visibility } from "./types";

export function getDocuments(filters?: {
  doc_type?: DocType;
  source?: DocumentSource;
  category?: string;
  q?: string;
  page?: number;
}): Promise<Paginated<DocumentSummary>> {
  const params = new URLSearchParams();
  if (filters?.doc_type) params.set("doc_type", filters.doc_type);
  if (filters?.source) params.set("source", filters.source);
  if (filters?.category) params.set("category", filters.category);
  if (filters?.q) params.set("q", filters.q);
  if (filters?.page) params.set("page", String(filters.page));
  const query = params.toString() ? `?${params.toString()}` : "";
  return apiJson<Paginated<DocumentSummary>>(`/api/v1/knowledge/documents/${query}`);
}

export function getDocument(id: string): Promise<DocumentDetail> {
  return apiJson<DocumentDetail>(`/api/v1/knowledge/documents/${id}/`);
}

export interface DocumentWritePayload {
  title?: string;
  description?: string;
  doc_type?: DocType;
  source?: DocumentSource;
  author?: string;
  organization?: string;
  publication_date?: string | null;
  url?: string;
  file_id?: string | null;
  category_id?: string | null;
  tag_names?: string[];
  visibility?: Visibility;
}

export function createDocument(payload: DocumentWritePayload): Promise<DocumentDetail> {
  return apiJson<DocumentDetail>("/api/v1/knowledge/documents/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function updateDocument(id: string, payload: DocumentWritePayload): Promise<DocumentDetail> {
  return apiJson<DocumentDetail>(`/api/v1/knowledge/documents/${id}/`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function deleteDocument(id: string): Promise<void> {
  return apiVoid(`/api/v1/knowledge/documents/${id}/`, { method: "DELETE" });
}
