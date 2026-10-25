import { ApiError, apiFetch, apiJson, apiUpload, apiVoid, extractApiError } from "./client";
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

export function deleteBackupJob(id: string): Promise<void> {
  return apiVoid(`/api/v1/backups/${id}/`, { method: "DELETE" });
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

/** Restores from a backup file the admin uploads (e.g. onto a fresh server) rather than one
 * stored server-side (RestoreJobUploadView). `passphrase` decrypts an encrypted .athar backup;
 * a plaintext .zip from before encryption needs none. Uses apiUpload for real progress. */
export function uploadRestoreArchive(
  file: File,
  passphrase: string,
  onProgress?: (fraction: number) => void,
): Promise<RestoreJob> {
  const formData = new FormData();
  formData.append("archive", file);
  if (passphrase) formData.append("passphrase", passphrase);
  return apiUpload<RestoreJob>("/api/v1/backups/restores/upload/", formData, onProgress);
}

export function getRestoreJob(id: string): Promise<RestoreJob> {
  return apiJson<RestoreJob>(`/api/v1/backups/restores/${id}/`);
}

/** Matches backend settings.BACKUP_PASSPHRASE_MIN_LENGTH - the backend
 * enforces it either way, this just lets the form say so up front. */
export const BACKUP_PASSPHRASE_MIN_LENGTH = 12;

/** Downloads a finished backup, encrypted with `passphrase`, through the auth-gated endpoint
 * (BackupJobDownloadView; POST so the passphrase stays out of URLs). A plain <a href> can't
 * carry the Bearer header, so this fetches from JS and triggers the browser's download manager. */
export async function downloadBackupJob(id: string, passphrase: string, filename: string): Promise<boolean> {
  const path = `/api/v1/backups/${id}/download/`;
  const res = await apiFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ passphrase }),
  });
  if (!res.ok) {
    const { message, fields } = await extractApiError(res, path);
    throw new ApiError(message, res.status, fields);
  }

  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  return true;
}
