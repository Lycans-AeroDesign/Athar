import { apiFetch, apiJson } from "./client";
import type { ArticleDetail, ArticleStatus, ArticleSummary, Answer, Category, QuestionDetail, QuestionSummary, Tag } from "./types";

export function getCategories(): Promise<Category[]> {
  return apiJson<Category[]>("/api/v1/knowledge/categories/");
}

export function getTags(): Promise<Tag[]> {
  return apiJson<Tag[]>("/api/v1/knowledge/tags/");
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

export async function deleteArticle(id: string): Promise<void> {
  await apiFetch(`/api/v1/knowledge/articles/${id}/`, { method: "DELETE" });
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

export async function deleteQuestion(id: string): Promise<void> {
  await apiFetch(`/api/v1/knowledge/questions/${id}/`, { method: "DELETE" });
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

export async function deleteAnswer(id: string): Promise<void> {
  await apiFetch(`/api/v1/knowledge/answers/${id}/`, { method: "DELETE" });
}

export function acceptAnswer(questionId: string, answerId: string | null): Promise<QuestionDetail> {
  return apiJson<QuestionDetail>(`/api/v1/knowledge/questions/${questionId}/accept/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ answer_id: answerId }),
  });
}
