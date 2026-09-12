import { apiJson, apiVoid } from "./client";
import type {
  CourseCategory,
  CourseDetail,
  CourseDifficulty,
  CourseEnrollment,
  CourseModule,
  CourseProgress,
  CourseResource,
  CourseResourceProvider,
  CourseResourceType,
  CourseStats,
  CourseStatusFilter,
  CourseSummary,
  KnowledgeReferenceType,
  LearningObjective,
  LessonDetail,
  LessonKnowledgeReferenceEntry,
  LessonSummary,
  LessonType,
  Paginated,
  TrainingStats,
} from "./types";

// Same "unwrap .results, return a bare array" convention as lib/api/knowledge.ts -
// page 1/20 items only; screens needing real paging (search) get bespoke handling.

export function listCourseCategories(): Promise<CourseCategory[]> {
  return apiJson<Paginated<CourseCategory>>("/api/v1/training/categories/").then((data) => data.results);
}

export function createCourseCategory(payload: { name: string; description?: string }): Promise<CourseCategory> {
  return apiJson<CourseCategory>("/api/v1/training/categories/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function updateCourseCategory(
  id: string,
  payload: { name?: string; description?: string },
): Promise<CourseCategory> {
  return apiJson<CourseCategory>(`/api/v1/training/categories/${id}/`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function deleteCourseCategory(id: string): Promise<void> {
  return apiVoid(`/api/v1/training/categories/${id}/`, { method: "DELETE" });
}

export function listCourses(params?: {
  status?: CourseStatusFilter;
  category?: string;
  difficulty?: CourseDifficulty;
}): Promise<CourseSummary[]> {
  const query = new URLSearchParams();
  if (params?.status) query.set("status", params.status);
  if (params?.category) query.set("category", params.category);
  if (params?.difficulty) query.set("difficulty", params.difficulty);
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return apiJson<Paginated<CourseSummary>>(`/api/v1/training/courses/${suffix}`).then((data) => data.results);
}

export function getCourse(id: string): Promise<CourseDetail> {
  return apiJson<CourseDetail>(`/api/v1/training/courses/${id}/`);
}

export interface CourseWritePayload {
  title?: string;
  short_description?: string;
  description?: string;
  category_id?: string | null;
  cover_image_id?: string | null;
  difficulty?: CourseDifficulty;
}

export function createCourse(payload: CourseWritePayload): Promise<CourseDetail> {
  return apiJson<CourseDetail>("/api/v1/training/courses/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function updateCourse(id: string, payload: CourseWritePayload): Promise<CourseDetail> {
  return apiJson<CourseDetail>(`/api/v1/training/courses/${id}/`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function deleteCourse(id: string): Promise<void> {
  return apiVoid(`/api/v1/training/courses/${id}/`, { method: "DELETE" });
}

export function submitCourse(id: string): Promise<CourseDetail> {
  return apiJson<CourseDetail>(`/api/v1/training/courses/${id}/submit/`, { method: "POST" });
}

export function publishCourse(id: string): Promise<CourseDetail> {
  return apiJson<CourseDetail>(`/api/v1/training/courses/${id}/publish/`, { method: "POST" });
}

export function rejectCourse(id: string, reason?: string): Promise<CourseDetail> {
  return apiJson<CourseDetail>(`/api/v1/training/courses/${id}/reject/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason: reason ?? "" }),
  });
}

export function archiveCourse(id: string): Promise<CourseDetail> {
  return apiJson<CourseDetail>(`/api/v1/training/courses/${id}/archive/`, { method: "POST" });
}

export function unarchiveCourse(id: string): Promise<CourseDetail> {
  return apiJson<CourseDetail>(`/api/v1/training/courses/${id}/unarchive/`, { method: "POST" });
}

export function enrollInCourse(id: string): Promise<CourseEnrollment> {
  return apiJson<CourseEnrollment>(`/api/v1/training/courses/${id}/enroll/`, { method: "POST" });
}

export function getCourseProgress(id: string): Promise<CourseProgress> {
  return apiJson<CourseProgress>(`/api/v1/training/courses/${id}/progress/`);
}

export function getCourseStats(id: string): Promise<CourseStats> {
  return apiJson<CourseStats>(`/api/v1/training/courses/${id}/stats/`);
}

export function getTrainingStats(): Promise<TrainingStats> {
  return apiJson<TrainingStats>("/api/v1/training/stats/");
}

export function listMyCourses(status?: "in_progress" | "completed"): Promise<CourseEnrollment[]> {
  const suffix = status ? `?status=${status}` : "";
  return apiJson<Paginated<CourseEnrollment>>(`/api/v1/training/my-courses/${suffix}`).then((data) => data.results);
}

export interface CourseSearchPage {
  results: CourseSummary[];
  count: number;
}

export function searchCourses(query: string, category?: string, difficulty?: CourseDifficulty): Promise<CourseSearchPage> {
  const params = new URLSearchParams({ q: query });
  if (category) params.set("category", category);
  if (difficulty) params.set("difficulty", difficulty);
  return apiJson<Paginated<CourseSummary>>(`/api/v1/training/search/?${params.toString()}`).then((data) => ({
    results: data.results,
    count: data.count,
  }));
}

// --- Modules -----------------------------------------------------------

export function createModule(
  courseId: string,
  payload: { title: string; description?: string; estimated_minutes?: number },
): Promise<CourseModule> {
  return apiJson<CourseModule>(`/api/v1/training/courses/${courseId}/modules/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function updateModule(
  id: string,
  payload: { title?: string; description?: string; estimated_minutes?: number },
): Promise<CourseModule> {
  return apiJson<CourseModule>(`/api/v1/training/modules/${id}/`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function deleteModule(id: string): Promise<void> {
  return apiVoid(`/api/v1/training/modules/${id}/`, { method: "DELETE" });
}

export function reorderModules(courseId: string, order: string[]): Promise<CourseModule[]> {
  return apiJson<CourseModule[]>(`/api/v1/training/courses/${courseId}/modules/reorder/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ order }),
  });
}

// --- Lessons -------------------------------------------------------------

export interface LessonWritePayload {
  title?: string;
  short_description?: string;
  lesson_type?: LessonType;
  content?: string;
  estimated_minutes?: number;
  is_required?: boolean;
}

export function createLesson(moduleId: string, payload: LessonWritePayload): Promise<LessonDetail> {
  return apiJson<LessonDetail>(`/api/v1/training/modules/${moduleId}/lessons/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function getLesson(id: string): Promise<LessonDetail> {
  return apiJson<LessonDetail>(`/api/v1/training/lessons/${id}/`);
}

export function updateLesson(id: string, payload: LessonWritePayload): Promise<LessonDetail> {
  return apiJson<LessonDetail>(`/api/v1/training/lessons/${id}/`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function deleteLesson(id: string): Promise<void> {
  return apiVoid(`/api/v1/training/lessons/${id}/`, { method: "DELETE" });
}

export function reorderLessons(moduleId: string, order: string[]): Promise<LessonSummary[]> {
  return apiJson<LessonSummary[]>(`/api/v1/training/modules/${moduleId}/lessons/reorder/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ order }),
  });
}

export function completeLesson(id: string): Promise<{ lesson_id: string; completed_at: string }> {
  return apiJson(`/api/v1/training/lessons/${id}/complete/`, { method: "POST" });
}

// --- Learning objectives ---------------------------------------------------

export function createObjective(lessonId: string, text: string): Promise<LearningObjective> {
  return apiJson<LearningObjective>(`/api/v1/training/lessons/${lessonId}/objectives/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
}

export function updateObjective(id: string, text: string): Promise<LearningObjective> {
  return apiJson<LearningObjective>(`/api/v1/training/objectives/${id}/`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
}

export function deleteObjective(id: string): Promise<void> {
  return apiVoid(`/api/v1/training/objectives/${id}/`, { method: "DELETE" });
}

export function reorderObjectives(lessonId: string, order: string[]): Promise<LearningObjective[]> {
  return apiJson<LearningObjective[]>(`/api/v1/training/lessons/${lessonId}/objectives/reorder/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ order }),
  });
}

// --- Resources -----------------------------------------------------------

export interface CourseResourceWritePayload {
  title?: string;
  description?: string;
  resource_type?: CourseResourceType;
  provider?: CourseResourceProvider;
  url?: string;
  stored_file_id?: string | null;
  is_primary?: boolean;
}

export function createResource(lessonId: string, payload: CourseResourceWritePayload): Promise<CourseResource> {
  return apiJson<CourseResource>(`/api/v1/training/lessons/${lessonId}/resources/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function updateResource(id: string, payload: CourseResourceWritePayload): Promise<CourseResource> {
  return apiJson<CourseResource>(`/api/v1/training/resources/${id}/`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function deleteResource(id: string): Promise<void> {
  return apiVoid(`/api/v1/training/resources/${id}/`, { method: "DELETE" });
}

export function reorderResources(lessonId: string, order: string[]): Promise<CourseResource[]> {
  return apiJson<CourseResource[]>(`/api/v1/training/lessons/${lessonId}/resources/reorder/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ order }),
  });
}

// --- Knowledge references -------------------------------------------------

export function listKnowledgeReferences(lessonId: string): Promise<LessonKnowledgeReferenceEntry[]> {
  return apiJson<LessonKnowledgeReferenceEntry[]>(`/api/v1/training/lessons/${lessonId}/knowledge-references/`);
}

export function createKnowledgeReference(
  lessonId: string,
  payload: { content_type: KnowledgeReferenceType; object_id: string; note?: string },
): Promise<LessonKnowledgeReferenceEntry> {
  return apiJson<LessonKnowledgeReferenceEntry>(`/api/v1/training/lessons/${lessonId}/knowledge-references/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function deleteKnowledgeReference(id: string): Promise<void> {
  return apiVoid(`/api/v1/training/knowledge-references/${id}/`, { method: "DELETE" });
}
