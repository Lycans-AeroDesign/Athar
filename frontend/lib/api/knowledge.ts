import { apiJson, apiVoid } from "./client";
import type {
  ArticleDetail,
  ArticleRevision,
  ArticleStatusFilter,
  ArticleSummary,
  Answer,
  Category,
  KnowledgeAttachment,
  KnowledgeRelation,
  Paginated,
  QuestionDetail,
  QuestionSummary,
  SearchResult,
  Tag,
  Visibility,
} from "./types";

// Every list endpoint returns a paginated {count, next, previous, results}
// envelope now (see backend/config/pagination.py) - these wrappers unwrap
// .results and keep returning a bare array so existing callers are
// unaffected. That means "page 1 only" (20 items) for now; screens that
// need real page-through UI (search results, admin settings screens) get
// their own dedicated handling elsewhere rather than through these.
export function getCategories(): Promise<Category[]> {
  return apiJson<Paginated<Category>>("/api/v1/knowledge/categories/").then((data) => data.results);
}

export function createCategory(payload: { name: string; description?: string }): Promise<Category> {
  return apiJson<Category>("/api/v1/knowledge/categories/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function updateCategory(id: string, payload: { name?: string; description?: string }): Promise<Category> {
  return apiJson<Category>(`/api/v1/knowledge/categories/${id}/`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function deleteCategory(id: string): Promise<void> {
  return apiVoid(`/api/v1/knowledge/categories/${id}/`, { method: "DELETE" });
}

export function getTags(): Promise<Tag[]> {
  return apiJson<Paginated<Tag>>("/api/v1/knowledge/tags/").then((data) => data.results);
}

export function createTag(name: string): Promise<Tag> {
  return apiJson<Tag>("/api/v1/knowledge/tags/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
}

export function deleteTag(id: string): Promise<void> {
  return apiVoid(`/api/v1/knowledge/tags/${id}/`, { method: "DELETE" });
}

export interface SearchPage {
  results: SearchResult[];
  hasMore: boolean;
}

export function searchKnowledge(query: string, type?: "article" | "question", page = 1): Promise<SearchPage> {
  const params = new URLSearchParams({ q: query, page: String(page) });
  if (type) params.set("type", type);
  return apiJson<{ results: SearchResult[]; has_more: boolean }>(
    `/api/v1/knowledge/search/?${params.toString()}`,
  ).then((data) => ({ results: data.results, hasMore: data.has_more }));
}

export function getArticles(status?: ArticleStatusFilter): Promise<ArticleSummary[]> {
  const query = status ? `?status=${status}` : "";
  return apiJson<Paginated<ArticleSummary>>(`/api/v1/knowledge/articles/${query}`).then((data) => data.results);
}

/** Published article count via the pagination envelope's `count` - ?page_size=1
 * so only one row is actually fetched. Used by the Dashboard's stat card. */
export function getArticleCount(): Promise<number> {
  return apiJson<Paginated<ArticleSummary>>("/api/v1/knowledge/articles/?page_size=1").then((data) => data.count);
}

export function getArticle(id: string): Promise<ArticleDetail> {
  return apiJson<ArticleDetail>(`/api/v1/knowledge/articles/${id}/`);
}

export interface ArticleWritePayload {
  title?: string;
  excerpt?: string;
  content?: string;
  category_id?: string | null;
  tag_names?: string[];
  visibility?: Visibility;
}

export function createArticle(payload: ArticleWritePayload): Promise<ArticleDetail> {
  return apiJson<ArticleDetail>("/api/v1/knowledge/articles/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function updateArticle(id: string, payload: ArticleWritePayload): Promise<ArticleDetail> {
  return apiJson<ArticleDetail>(`/api/v1/knowledge/articles/${id}/`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function submitArticle(id: string): Promise<ArticleDetail> {
  return apiJson<ArticleDetail>(`/api/v1/knowledge/articles/${id}/submit/`, { method: "POST" });
}

export function publishArticle(id: string): Promise<ArticleDetail> {
  return apiJson<ArticleDetail>(`/api/v1/knowledge/articles/${id}/publish/`, { method: "POST" });
}

export function rejectArticle(id: string, reason?: string): Promise<ArticleDetail> {
  return apiJson<ArticleDetail>(`/api/v1/knowledge/articles/${id}/reject/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason: reason ?? "" }),
  });
}

export function archiveArticle(id: string): Promise<ArticleDetail> {
  return apiJson<ArticleDetail>(`/api/v1/knowledge/articles/${id}/archive/`, { method: "POST" });
}

export function unarchiveArticle(id: string): Promise<ArticleDetail> {
  return apiJson<ArticleDetail>(`/api/v1/knowledge/articles/${id}/unarchive/`, { method: "POST" });
}

export function getArticleRevisions(id: string): Promise<ArticleRevision[]> {
  return apiJson<ArticleRevision[]>(`/api/v1/knowledge/articles/${id}/revisions/`);
}

export function deleteArticle(id: string): Promise<void> {
  return apiVoid(`/api/v1/knowledge/articles/${id}/`, { method: "DELETE" });
}

export function getQuestions(): Promise<QuestionSummary[]> {
  return apiJson<Paginated<QuestionSummary>>("/api/v1/knowledge/questions/").then((data) => data.results);
}

/** Count of OPEN questions via the pagination envelope's `count` - ?page_size=1
 * so only one row is actually fetched. Used by the Dashboard's stat card. */
export function getOpenQuestionCount(): Promise<number> {
  return apiJson<Paginated<QuestionSummary>>("/api/v1/knowledge/questions/?status=OPEN&page_size=1").then(
    (data) => data.count,
  );
}

export function getQuestion(id: string): Promise<QuestionDetail> {
  return apiJson<QuestionDetail>(`/api/v1/knowledge/questions/${id}/`);
}

export function createQuestion(
  payload: { title: string; body?: string; tag_names?: string[]; visibility?: Visibility },
): Promise<QuestionDetail> {
  return apiJson<QuestionDetail>("/api/v1/knowledge/questions/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function updateQuestion(
  id: string,
  payload: { title?: string; body?: string; tag_names?: string[]; visibility?: Visibility },
): Promise<QuestionDetail> {
  return apiJson<QuestionDetail>(`/api/v1/knowledge/questions/${id}/`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function deleteQuestion(id: string): Promise<void> {
  return apiVoid(`/api/v1/knowledge/questions/${id}/`, { method: "DELETE" });
}

export function createAnswer(questionId: string, body: string): Promise<Answer> {
  return apiJson<Answer>(`/api/v1/knowledge/questions/${questionId}/answers/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body }),
  });
}

export function updateAnswer(id: string, body: string): Promise<Answer> {
  return apiJson<Answer>(`/api/v1/knowledge/answers/${id}/`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body }),
  });
}

export function deleteAnswer(id: string): Promise<void> {
  return apiVoid(`/api/v1/knowledge/answers/${id}/`, { method: "DELETE" });
}

export function acceptAnswer(questionId: string, answerId: string | null): Promise<QuestionDetail> {
  return apiJson<QuestionDetail>(`/api/v1/knowledge/questions/${questionId}/accept/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ answer_id: answerId }),
  });
}

export function closeQuestion(id: string): Promise<QuestionDetail> {
  return apiJson<QuestionDetail>(`/api/v1/knowledge/questions/${id}/close/`, { method: "POST" });
}

export function reopenQuestion(id: string): Promise<QuestionDetail> {
  return apiJson<QuestionDetail>(`/api/v1/knowledge/questions/${id}/reopen/`, { method: "POST" });
}

export function promoteQuestion(id: string): Promise<ArticleDetail> {
  return apiJson<ArticleDetail>(`/api/v1/knowledge/questions/${id}/promote/`, { method: "POST" });
}

export function getRelations(type: "article" | "question", id: string): Promise<KnowledgeRelation[]> {
  return apiJson<KnowledgeRelation[]>(`/api/v1/knowledge/${type}s/${id}/relations/`);
}

export function createRelation(payload: {
  source_type: "article" | "question";
  source_id: string;
  target_type: "article" | "question";
  target_id: string;
}): Promise<KnowledgeRelation> {
  return apiJson<KnowledgeRelation>("/api/v1/knowledge/relations/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function deleteRelation(id: string): Promise<void> {
  return apiVoid(`/api/v1/knowledge/relations/${id}/`, { method: "DELETE" });
}

export function getArticleAttachments(articleId: string): Promise<KnowledgeAttachment[]> {
  return apiJson<KnowledgeAttachment[]>(`/api/v1/knowledge/articles/${articleId}/attachments/`);
}

export function addArticleAttachment(articleId: string, fileId: string): Promise<KnowledgeAttachment> {
  return apiJson<KnowledgeAttachment>(`/api/v1/knowledge/articles/${articleId}/attachments/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_id: fileId }),
  });
}

export function removeArticleAttachment(articleId: string, attachmentId: string): Promise<void> {
  return apiVoid(`/api/v1/knowledge/articles/${articleId}/attachments/${attachmentId}/`, { method: "DELETE" });
}

export function getQuestionAttachments(questionId: string): Promise<KnowledgeAttachment[]> {
  return apiJson<KnowledgeAttachment[]>(`/api/v1/knowledge/questions/${questionId}/attachments/`);
}

export function addQuestionAttachment(questionId: string, fileId: string): Promise<KnowledgeAttachment> {
  return apiJson<KnowledgeAttachment>(`/api/v1/knowledge/questions/${questionId}/attachments/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_id: fileId }),
  });
}

export function removeQuestionAttachment(questionId: string, attachmentId: string): Promise<void> {
  return apiVoid(`/api/v1/knowledge/questions/${questionId}/attachments/${attachmentId}/`, { method: "DELETE" });
}
