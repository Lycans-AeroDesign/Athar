import { apiFetch, apiJson } from "./client";
import type { BackupJob, Paginated, RestoreJob } from "./types";

export function getBackupJobs(): Promise<BackupJob[]> {
  return apiJson<Paginated<BackupJob>>("/api/v1/backups/").then((data) => data.results);
}

export function createBackupJob(): Promise<BackupJob> {
  return apiJson<BackupJob>("/api/v1/backups/", { method: "POST" });
}

export function getBackupJob(id: string): Promise<BackupJob> {
  return apiJson<BackupJob>(`/api/v1/backups/${id}/`);
}

export function getRestoreJobs(): Promise<RestoreJob[]> {
  return apiJson<Paginated<RestoreJob>>("/api/v1/backups/restores/").then((data) => data.results);
}

export function createRestoreJob(backupJobId: string): Promise<RestoreJob> {
  return apiJson<RestoreJob>("/api/v1/backups/restores/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ backup_job_id: backupJobId }),
  });
}

export function getRestoreJob(id: string): Promise<RestoreJob> {
  return apiJson<RestoreJob>(`/api/v1/backups/restores/${id}/`);
}

/** Downloads a finished backup archive through the auth-gated endpoint (see
 * backend/backups/views.py) - same blob: URL approach as lib/api/files.ts's
 * downloadFile, since a plain <a href> can't carry the Bearer header. */
export async function downloadBackupJob(id: string, filename: string): Promise<void> {
  const res = await apiFetch(`/api/v1/backups/${id}/download/`);
  if (!res.ok) throw new Error(`Failed to download backup (${res.status})`);
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
