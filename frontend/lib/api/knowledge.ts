import { apiJson, apiVoid } from "./client";
import type {
  ArticleDetail,
  ArticleRevision,
  ArticleStatus,
  ArticleSummary,
  Answer,
  Category,
  QuestionDetail,
  QuestionSummary,
  SearchResult,
  Tag,
} from "./types";

export function getCategories(): Promise<Category[]> {
  return apiJson<Category[]>("/api/v1/knowledge/categories/");
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
  return apiJson<Tag[]>("/api/v1/knowledge/tags/");
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

export function searchKnowledge(query: string, type?: "article" | "question"): Promise<SearchResult[]> {
  const params = new URLSearchParams({ q: query });
  if (type) params.set("type", type);
  return apiJson<{ results: SearchResult[] }>(`/api/v1/knowledge/search/?${params.toString()}`).then(
    (data) => data.results,
  );
}

export function getArticles(status?: ArticleStatus): Promise<ArticleSummary[]> {
  const query = status ? `?status=${status}` : "";
  return apiJson<ArticleSummary[]>(`/api/v1/knowledge/articles/${query}`);
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

export function getArticleRevisions(id: string): Promise<ArticleRevision[]> {
  return apiJson<ArticleRevision[]>(`/api/v1/knowledge/articles/${id}/revisions/`);
}

export function deleteArticle(id: string): Promise<void> {
  return apiVoid(`/api/v1/knowledge/articles/${id}/`, { method: "DELETE" });
}

export function getQuestions(): Promise<QuestionSummary[]> {
  return apiJson<QuestionSummary[]>("/api/v1/knowledge/questions/");
}

export function getQuestion(id: string): Promise<QuestionDetail> {
  return apiJson<QuestionDetail>(`/api/v1/knowledge/questions/${id}/`);
}

export function createQuestion(payload: { title: string; body?: string; tag_names?: string[] }): Promise<QuestionDetail> {
  return apiJson<QuestionDetail>("/api/v1/knowledge/questions/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function updateQuestion(
  id: string,
  payload: { title?: string; body?: string; tag_names?: string[] },
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
