// Projects/Components/Failures/SOPs - split out from knowledge.ts (which was
// getting unwieldy) once this domain's CRUD+attachment surface reached the
// same size as Articles/Questions combined. Same conventions as knowledge.ts:
// list endpoints unwrap the paginated envelope to a bare array (page 1/20
// items only, for now - see that file's top-of-file note), write payloads
// use `..._id`/`tag_names` field names matching the backend's WriteSerializers.

import { apiJson, apiVoid } from "./client";
import type {
  ComponentDetail,
  ComponentStatus,
  ComponentSpecRow,
  ComponentSummary,
  FailureDetail,
  FailureSeverity,
  FailureStatus,
  FailureSummary,
  KnowledgeAttachment,
  Paginated,
  ProjectDetail,
  ProjectStatus,
  ProjectSummary,
  SopDetail,
  SopSummary,
} from "./types";

// --- Projects ---------------------------------------------------------------

export function getProjects(statusFilter?: ProjectStatus): Promise<ProjectSummary[]> {
  const query = statusFilter ? `?status=${statusFilter}` : "";
  return apiJson<Paginated<ProjectSummary>>(`/api/v1/knowledge/projects/${query}`).then((data) => data.results);
}

export function getProject(id: string): Promise<ProjectDetail> {
  return apiJson<ProjectDetail>(`/api/v1/knowledge/projects/${id}/`);
}

export interface ProjectWritePayload {
  name?: string;
  description?: string;
  status?: ProjectStatus;
  tag_names?: string[];
}

export function createProject(payload: ProjectWritePayload): Promise<ProjectDetail> {
  return apiJson<ProjectDetail>("/api/v1/knowledge/projects/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function updateProject(id: string, payload: ProjectWritePayload): Promise<ProjectDetail> {
  return apiJson<ProjectDetail>(`/api/v1/knowledge/projects/${id}/`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function deleteProject(id: string): Promise<void> {
  return apiVoid(`/api/v1/knowledge/projects/${id}/`, { method: "DELETE" });
}

export function getProjectAttachments(projectId: string): Promise<KnowledgeAttachment[]> {
  return apiJson<KnowledgeAttachment[]>(`/api/v1/knowledge/projects/${projectId}/attachments/`);
}

export function addProjectAttachment(projectId: string, fileId: string): Promise<KnowledgeAttachment> {
  return apiJson<KnowledgeAttachment>(`/api/v1/knowledge/projects/${projectId}/attachments/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_id: fileId }),
  });
}

export function removeProjectAttachment(projectId: string, attachmentId: string): Promise<void> {
  return apiVoid(`/api/v1/knowledge/projects/${projectId}/attachments/${attachmentId}/`, { method: "DELETE" });
}

// --- Components ---------------------------------------------------------------

export function getComponents(filters?: { category?: string; status?: ComponentStatus }): Promise<ComponentSummary[]> {
  const params = new URLSearchParams();
  if (filters?.category) params.set("category", filters.category);
  if (filters?.status) params.set("status", filters.status);
  const query = params.toString() ? `?${params.toString()}` : "";
  return apiJson<Paginated<ComponentSummary>>(`/api/v1/knowledge/components/${query}`).then((data) => data.results);
}

export function getComponent(id: string): Promise<ComponentDetail> {
  return apiJson<ComponentDetail>(`/api/v1/knowledge/components/${id}/`);
}

export interface ComponentWritePayload {
  name?: string;
  category_id?: string | null;
  manufacturer?: string;
  part_number?: string;
  status?: ComponentStatus;
  summary?: string;
  specifications?: ComponentSpecRow[];
  tag_names?: string[];
}

export function createComponent(payload: ComponentWritePayload): Promise<ComponentDetail> {
  return apiJson<ComponentDetail>("/api/v1/knowledge/components/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function updateComponent(id: string, payload: ComponentWritePayload): Promise<ComponentDetail> {
  return apiJson<ComponentDetail>(`/api/v1/knowledge/components/${id}/`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function deleteComponent(id: string): Promise<void> {
  return apiVoid(`/api/v1/knowledge/components/${id}/`, { method: "DELETE" });
}

export function getComponentAttachments(componentId: string): Promise<KnowledgeAttachment[]> {
  return apiJson<KnowledgeAttachment[]>(`/api/v1/knowledge/components/${componentId}/attachments/`);
}

export function addComponentAttachment(componentId: string, fileId: string): Promise<KnowledgeAttachment> {
  return apiJson<KnowledgeAttachment>(`/api/v1/knowledge/components/${componentId}/attachments/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_id: fileId }),
  });
}

export function removeComponentAttachment(componentId: string, attachmentId: string): Promise<void> {
  return apiVoid(`/api/v1/knowledge/components/${componentId}/attachments/${attachmentId}/`, { method: "DELETE" });
}

// --- Failures ---------------------------------------------------------------

export function getFailures(filters?: { severity?: FailureSeverity; status?: FailureStatus }): Promise<FailureSummary[]> {
  const params = new URLSearchParams();
  if (filters?.severity) params.set("severity", filters.severity);
  if (filters?.status) params.set("status", filters.status);
  const query = params.toString() ? `?${params.toString()}` : "";
  return apiJson<Paginated<FailureSummary>>(`/api/v1/knowledge/failures/${query}`).then((data) => data.results);
}

export function getFailure(id: string): Promise<FailureDetail> {
  return apiJson<FailureDetail>(`/api/v1/knowledge/failures/${id}/`);
}

export interface FailureWritePayload {
  title?: string;
  component_id?: string | null;
  project_id?: string | null;
  aircraft?: string;
  date?: string | null;
  severity?: FailureSeverity;
  status?: FailureStatus;
  summary?: string;
  root_cause?: string;
  corrective_action?: string;
  preventive_action?: string;
}

export function createFailure(payload: FailureWritePayload): Promise<FailureDetail> {
  return apiJson<FailureDetail>("/api/v1/knowledge/failures/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function updateFailure(id: string, payload: FailureWritePayload): Promise<FailureDetail> {
  return apiJson<FailureDetail>(`/api/v1/knowledge/failures/${id}/`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function deleteFailure(id: string): Promise<void> {
  return apiVoid(`/api/v1/knowledge/failures/${id}/`, { method: "DELETE" });
}

export function getFailureAttachments(failureId: string): Promise<KnowledgeAttachment[]> {
  return apiJson<KnowledgeAttachment[]>(`/api/v1/knowledge/failures/${failureId}/attachments/`);
}

export function addFailureAttachment(failureId: string, fileId: string): Promise<KnowledgeAttachment> {
  return apiJson<KnowledgeAttachment>(`/api/v1/knowledge/failures/${failureId}/attachments/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_id: fileId }),
  });
}

export function removeFailureAttachment(failureId: string, attachmentId: string): Promise<void> {
  return apiVoid(`/api/v1/knowledge/failures/${failureId}/attachments/${attachmentId}/`, { method: "DELETE" });
}

// --- SOPs ---------------------------------------------------------------

export function getSops(filters?: { category?: string; mandatory?: boolean }): Promise<SopSummary[]> {
  const params = new URLSearchParams();
  if (filters?.category) params.set("category", filters.category);
  if (filters?.mandatory) params.set("mandatory", "true");
  const query = params.toString() ? `?${params.toString()}` : "";
  return apiJson<Paginated<SopSummary>>(`/api/v1/knowledge/sops/${query}`).then((data) => data.results);
}

export function getSop(id: string): Promise<SopDetail> {
  return apiJson<SopDetail>(`/api/v1/knowledge/sops/${id}/`);
}

export interface SopWritePayload {
  title?: string;
  category_id?: string | null;
  mandatory?: boolean;
  safety_notes?: string;
  content?: string;
  tag_names?: string[];
}

export function createSop(payload: SopWritePayload): Promise<SopDetail> {
  return apiJson<SopDetail>("/api/v1/knowledge/sops/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function updateSop(id: string, payload: SopWritePayload): Promise<SopDetail> {
  return apiJson<SopDetail>(`/api/v1/knowledge/sops/${id}/`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function deleteSop(id: string): Promise<void> {
  return apiVoid(`/api/v1/knowledge/sops/${id}/`, { method: "DELETE" });
}

export function getSopAttachments(sopId: string): Promise<KnowledgeAttachment[]> {
  return apiJson<KnowledgeAttachment[]>(`/api/v1/knowledge/sops/${sopId}/attachments/`);
}

export function addSopAttachment(sopId: string, fileId: string): Promise<KnowledgeAttachment> {
  return apiJson<KnowledgeAttachment>(`/api/v1/knowledge/sops/${sopId}/attachments/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_id: fileId }),
  });
}

export function removeSopAttachment(sopId: string, attachmentId: string): Promise<void> {
  return apiVoid(`/api/v1/knowledge/sops/${sopId}/attachments/${attachmentId}/`, { method: "DELETE" });
}
