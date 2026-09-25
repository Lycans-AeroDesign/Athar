// Projects/Components/Failures/SOPs - split out from knowledge.ts (which was
// getting unwieldy) once this domain's CRUD+attachment surface reached the
// same size as Articles/Questions combined. Same conventions as knowledge.ts,
// except list endpoints return the full `Paginated<T>` envelope (not just
// `.results`) so the list pages can drive a real Pagination control - write
// payloads use `..._id`/`tag_names` field names matching the backend's
// WriteSerializers.

import { apiFetch, apiJson, apiUpload, apiVoid } from "./client";
import type {
  ComponentCategory,
  ComponentCondition,
  ComponentDetail,
  ComponentStatus,
  ComponentSpecRow,
  ComponentSummary,
  FailureDetail,
  FailureSeverity,
  FailureStatus,
  FailureSummary,
  InventorySummary,
  InventoryType,
  KnowledgeAttachment,
  Paginated,
  ProjectDetail,
  ProjectStatus,
  ProjectSummary,
  SopDetail,
  SopSummary,
  StockStatus,
  StorageLocation,
  TestDetail,
  TestPassFail,
  TestRunStatus,
  TestSummary,
  TestType,
  Visibility,
} from "./types";

// --- Projects ---------------------------------------------------------------

export function getProjects(filters?: {
  status?: ProjectStatus;
  q?: string;
  page?: number;
}): Promise<Paginated<ProjectSummary>> {
  const params = new URLSearchParams();
  if (filters?.status) params.set("status", filters.status);
  if (filters?.q) params.set("q", filters.q);
  if (filters?.page) params.set("page", String(filters.page));
  const query = params.toString() ? `?${params.toString()}` : "";
  return apiJson<Paginated<ProjectSummary>>(`/api/v1/knowledge/projects/${query}`);
}

export function getProject(id: string): Promise<ProjectDetail> {
  return apiJson<ProjectDetail>(`/api/v1/knowledge/projects/${id}/`);
}

export interface ProjectWritePayload {
  name?: string;
  description?: string;
  status?: ProjectStatus;
  visibility?: Visibility;
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

/** Sortable columns for the table view - see backend/knowledge/views.py's
 * COMPONENT_ORDERING_FIELDS, the allowlist this must stay in sync with.
 * "-"-prefix a value for descending. */
export type ComponentOrdering =
  | "name" | "-name"
  | "category" | "-category"
  | "manufacturer" | "-manufacturer"
  | "part_number" | "-part_number"
  | "status" | "-status"
  | "quantity_available" | "-quantity_available"
  | "visibility" | "-visibility"
  | "inventory_type" | "-inventory_type"
  | "location" | "-location"
  | "unit" | "-unit"
  | "condition" | "-condition"
  | "stock_status" | "-stock_status"
  | "min_quantity" | "-min_quantity"
  | "created_at" | "-created_at"
  | "updated_at" | "-updated_at";

/** Shared by the list, the CSV export and the inventory summary, so all
 * three always describe the same set of components. */
export interface ComponentFilters {
  category?: string;
  location?: string;
  status?: ComponentStatus;
  inventoryType?: InventoryType;
  condition?: ComponentCondition;
  /** Any of these - e.g. ["MISSING", "ON_ORDER"] for "needs ordering". */
  stockStatuses?: StockStatus[];
  q?: string;
  ordering?: ComponentOrdering;
}

function componentFilterParams(filters?: ComponentFilters & { page?: number }): string {
  const params = new URLSearchParams();
  if (filters?.category) params.set("category", filters.category);
  if (filters?.location) params.set("location", filters.location);
  if (filters?.status) params.set("status", filters.status);
  if (filters?.inventoryType) params.set("inventory_type", filters.inventoryType);
  if (filters?.condition) params.set("condition", filters.condition);
  if (filters?.stockStatuses?.length) params.set("stock_status", filters.stockStatuses.join(","));
  if (filters?.q) params.set("q", filters.q);
  if (filters?.page) params.set("page", String(filters.page));
  if (filters?.ordering) params.set("ordering", filters.ordering);
  return params.toString() ? `?${params.toString()}` : "";
}

export function getComponents(filters?: ComponentFilters & { page?: number }): Promise<Paginated<ComponentSummary>> {
  return apiJson<Paginated<ComponentSummary>>(`/api/v1/knowledge/components/${componentFilterParams(filters)}`);
}

export function getComponent(id: string): Promise<ComponentDetail> {
  return apiJson<ComponentDetail>(`/api/v1/knowledge/components/${id}/`);
}

/** The inventory sheet's Summary tab, live - over the same filters as the list. */
export function getInventorySummary(filters?: ComponentFilters): Promise<InventorySummary> {
  return apiJson<InventorySummary>(`/api/v1/knowledge/components/inventory-summary/${componentFilterParams(filters)}`);
}

export interface ComponentWritePayload {
  name?: string;
  category_id?: string | null;
  photo_id?: string | null;
  manufacturer?: string;
  part_number?: string;
  link?: string;
  quantity_available?: number;
  status?: ComponentStatus | "";
  inventory_type?: InventoryType | "";
  /** By name - a place that doesn't exist yet is created; "" clears it. */
  location_name?: string;
  unit?: string;
  condition?: ComponentCondition | "";
  /** "" = work it out from the quantity. Omit to leave it alone (it then
   * still follows a quantity change while it's automatic). */
  stock_status?: StockStatus | "";
  min_quantity?: number | null;
  inventory_notes?: string;
  summary?: string;
  specifications?: ComponentSpecRow[];
  visibility?: Visibility;
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

// --- Component categories & storage locations -------------------------------

// page_size=100 (the backend max): these are short, whole-list pickers, and
// the default page of 20 would silently drop entries from them.

export function getComponentCategories(): Promise<ComponentCategory[]> {
  return apiJson<Paginated<ComponentCategory>>("/api/v1/knowledge/components/categories/?page_size=100").then(
    (data) => data.results,
  );
}

export function createComponentCategory(payload: { name: string; description?: string }): Promise<ComponentCategory> {
  return apiJson<ComponentCategory>("/api/v1/knowledge/components/categories/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function updateComponentCategory(
  id: string,
  payload: { name?: string; description?: string },
): Promise<ComponentCategory> {
  return apiJson<ComponentCategory>(`/api/v1/knowledge/components/categories/${id}/`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function deleteComponentCategory(id: string): Promise<void> {
  return apiVoid(`/api/v1/knowledge/components/categories/${id}/`, { method: "DELETE" });
}

export function getStorageLocations(): Promise<StorageLocation[]> {
  return apiJson<Paginated<StorageLocation>>("/api/v1/knowledge/components/locations/?page_size=100").then(
    (data) => data.results,
  );
}

export function createStorageLocation(payload: { name: string; description?: string }): Promise<StorageLocation> {
  return apiJson<StorageLocation>("/api/v1/knowledge/components/locations/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

/** Renaming a location to another location's name merges the two - the
 * returned location is the one that remains (it may not be `id`). */
export function updateStorageLocation(
  id: string,
  payload: { name?: string; description?: string },
): Promise<StorageLocation> {
  return apiJson<StorageLocation>(`/api/v1/knowledge/components/locations/${id}/`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function deleteStorageLocation(id: string): Promise<void> {
  return apiVoid(`/api/v1/knowledge/components/locations/${id}/`, { method: "DELETE" });
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

async function downloadBlob(path: string, filename: string, errorLabel: string): Promise<void> {
  const res = await apiFetch(path);
  if (!res.ok) throw new Error(`${errorLabel} (${res.status})`);
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
}

/** Downloads the (optionally filtered) Components list as CSV through the
 * auth-gated endpoint (see backend/knowledge/views.py's ComponentExportView) -
 * a blob: URL, since a plain <a href> can't carry the Bearer header. The
 * layout pastes straight back into the workshop inventory sheet. */
export function exportComponentsCsv(filters?: ComponentFilters): Promise<void> {
  // Named after the sheet tab it pastes into when filtered to one.
  const filename = filters?.inventoryType ? `inventory-${filters.inventoryType.toLowerCase()}.csv` : "components.csv";
  return downloadBlob(
    `/api/v1/knowledge/components/export/${componentFilterParams(filters)}`,
    filename,
    "Failed to export components",
  );
}

/** Downloads a starting-point CSV for bulk-importing components (see
 * backend/knowledge/views.py's ComponentImportTemplateView). */
export function downloadComponentImportTemplate(): Promise<void> {
  return downloadBlob(
    "/api/v1/knowledge/components/import/template/",
    "components-template.csv",
    "Failed to download template",
  );
}

export interface ComponentImportFieldChange {
  old: string;
  new: string;
}

export type ComponentImportRowAction = "create" | "update" | "unchanged" | "error" | "merged";

export interface ComponentImportRow {
  row: number;
  action: ComponentImportRowAction;
  /** Absent only for a row that couldn't be read at all (an error). */
  name?: string;
  /** Present for create/update - field key (e.g. "quantity_available") to {old, new} display strings. */
  changes?: Record<string, ComponentImportFieldChange>;
  /** Present for error only. */
  message?: string;
  /** Things worth a second look that don't stop the row, e.g. a website edit it would overwrite. */
  warnings: string[];
  /** Present for merged only - the row this one was folded into. */
  merged_into?: number;
}

export interface ComponentImportPreview {
  rows: ComponentImportRow[];
  summary: {
    create: number;
    update: number;
    unchanged: number;
    error: number;
    merged: number;
    /** Groups of rows with the same item and location (and no Athar ID). */
    duplicate_groups: number;
  };
  /** Present only when the request was sent with commit=true. */
  applied?: { created: number; updated: number; skipped: number };
}

export interface ComponentImportOptions {
  /** What to do with rows that share an item and location - see the backend's import_components_csv. */
  duplicates?: "separate" | "merge";
  /** The sheet tab this file came from, for rows with no Inventory Type cell. */
  inventoryType?: InventoryType;
}

/** Previews (commit=false) or applies (commit=true) a bulk CSV import of
 * components (see backend/knowledge/services.py's import_components_csv for
 * the full preview/commit contract, matching and per-row validation). Call
 * with commit=false first to get a diff to show the user, then re-call with
 * the SAME file and options and commit=true once they confirm - the backend
 * never writes anything on a commit=false call. Uses apiUpload (not apiJson)
 * for the same real-progress reason as uploadFile in lib/api/files.ts. */
export function importComponentsCsv(
  file: File,
  commit: boolean,
  options?: ComponentImportOptions,
  onProgress?: (fraction: number) => void,
): Promise<ComponentImportPreview> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("commit", commit ? "true" : "false");
  formData.append("duplicates", options?.duplicates ?? "separate");
  if (options?.inventoryType) formData.append("inventory_type", options.inventoryType);
  return apiUpload<ComponentImportPreview>("/api/v1/knowledge/components/import/", formData, onProgress);
}

// --- Failures ---------------------------------------------------------------

/** See backend/knowledge/views.py's FAILURE_ORDERING_FIELDS, the allowlist this must stay in sync with. */
export type FailureOrdering =
  | "title" | "-title"
  | "component" | "-component"
  | "project" | "-project"
  | "aircraft" | "-aircraft"
  | "date" | "-date"
  | "severity" | "-severity"
  | "status" | "-status"
  | "visibility" | "-visibility"
  | "created_at" | "-created_at"
  | "updated_at" | "-updated_at";

export function getFailures(filters?: {
  severity?: FailureSeverity;
  status?: FailureStatus;
  q?: string;
  page?: number;
  ordering?: FailureOrdering;
}): Promise<Paginated<FailureSummary>> {
  const params = new URLSearchParams();
  if (filters?.severity) params.set("severity", filters.severity);
  if (filters?.status) params.set("status", filters.status);
  if (filters?.q) params.set("q", filters.q);
  if (filters?.page) params.set("page", String(filters.page));
  if (filters?.ordering) params.set("ordering", filters.ordering);
  const query = params.toString() ? `?${params.toString()}` : "";
  return apiJson<Paginated<FailureSummary>>(`/api/v1/knowledge/failures/${query}`);
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
  visibility?: Visibility;
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

export function getSops(filters?: {
  category?: string;
  mandatory?: boolean;
  q?: string;
  page?: number;
}): Promise<Paginated<SopSummary>> {
  const params = new URLSearchParams();
  if (filters?.category) params.set("category", filters.category);
  if (filters?.mandatory) params.set("mandatory", "true");
  if (filters?.q) params.set("q", filters.q);
  if (filters?.page) params.set("page", String(filters.page));
  const query = params.toString() ? `?${params.toString()}` : "";
  return apiJson<Paginated<SopSummary>>(`/api/v1/knowledge/sops/${query}`);
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
  visibility?: Visibility;
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

// --- Tests / Experiments -----------------------------------------------------

/** See backend/knowledge/views.py's TEST_ORDERING_FIELDS, the allowlist this must stay in sync with. */
export type TestOrdering =
  | "title" | "-title"
  | "test_type" | "-test_type"
  | "date" | "-date"
  | "location" | "-location"
  | "project" | "-project"
  | "status" | "-status"
  | "pass_fail" | "-pass_fail"
  | "visibility" | "-visibility"
  | "created_at" | "-created_at"
  | "updated_at" | "-updated_at";

export function getTests(filters?: {
  test_type?: TestType;
  status?: TestRunStatus;
  pass_fail?: TestPassFail;
  q?: string;
  page?: number;
  ordering?: TestOrdering;
}): Promise<Paginated<TestSummary>> {
  const params = new URLSearchParams();
  if (filters?.test_type) params.set("test_type", filters.test_type);
  if (filters?.status) params.set("status", filters.status);
  if (filters?.pass_fail) params.set("pass_fail", filters.pass_fail);
  if (filters?.q) params.set("q", filters.q);
  if (filters?.page) params.set("page", String(filters.page));
  if (filters?.ordering) params.set("ordering", filters.ordering);
  const query = params.toString() ? `?${params.toString()}` : "";
  return apiJson<Paginated<TestSummary>>(`/api/v1/knowledge/tests/${query}`);
}

export function getTest(id: string): Promise<TestDetail> {
  return apiJson<TestDetail>(`/api/v1/knowledge/tests/${id}/`);
}

export interface TestWritePayload {
  title?: string;
  test_type?: TestType;
  date?: string | null;
  location?: string;
  project_id?: string | null;
  objective?: string;
  status?: TestRunStatus;
  configuration?: string;
  procedure?: string;
  results?: string;
  pass_fail?: TestPassFail;
  conclusion?: string;
  visibility?: Visibility;
  tag_names?: string[];
}

export function createTest(payload: TestWritePayload): Promise<TestDetail> {
  return apiJson<TestDetail>("/api/v1/knowledge/tests/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function updateTest(id: string, payload: TestWritePayload): Promise<TestDetail> {
  return apiJson<TestDetail>(`/api/v1/knowledge/tests/${id}/`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function deleteTest(id: string): Promise<void> {
  return apiVoid(`/api/v1/knowledge/tests/${id}/`, { method: "DELETE" });
}

export function getTestAttachments(testId: string): Promise<KnowledgeAttachment[]> {
  return apiJson<KnowledgeAttachment[]>(`/api/v1/knowledge/tests/${testId}/attachments/`);
}

export function addTestAttachment(testId: string, fileId: string): Promise<KnowledgeAttachment> {
  return apiJson<KnowledgeAttachment>(`/api/v1/knowledge/tests/${testId}/attachments/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_id: fileId }),
  });
}

export function removeTestAttachment(testId: string, attachmentId: string): Promise<void> {
  return apiVoid(`/api/v1/knowledge/tests/${testId}/attachments/${attachmentId}/`, { method: "DELETE" });
}
