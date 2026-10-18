import { ApiError, apiFetch, apiJson, apiUpload, extractApiError } from "./client";
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

// The File System Access API's save picker - Chromium-only (Chrome, Edge),
// and not in TypeScript's DOM lib yet, hence the minimal local typing.
type SaveFilePicker = (options: {
  suggestedName?: string;
  types?: { description?: string; accept: Record<string, string[]> }[];
}) => Promise<{ createWritable: () => Promise<WritableStream<Uint8Array>> }>;

/** Downloads a finished backup, encrypted with `passphrase`, through the auth-gated endpoint
 * (BackupJobDownloadView; POST so the passphrase stays out of URLs). A plain <a href> can't
 * carry the Bearer header, so this fetches from JS.
 *
 * Where supported, the response is streamed straight into a file the admin picks, never held
 * in memory: a backup can be gigabytes and Chrome fails `res.blob()` once a blob outgrows its
 * limit. Elsewhere it falls back to the blob: URL approach of lib/api/files.ts's downloadFile.
 * Resolves false if the admin cancels the save dialog. */
export async function downloadBackupJob(id: string, passphrase: string, filename: string): Promise<boolean> {
  const showSaveFilePicker = (window as Window & { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker;
  let writable: WritableStream<Uint8Array> | null = null;
  if (showSaveFilePicker) {
    // Before the fetch, while the click's user activation is still fresh -
    // the picker refuses to open without one.
    try {
      const handle = await showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: "Athar backup", accept: { "application/octet-stream": [".athar"] } }],
      });
      writable = await handle.createWritable();
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return false;
      throw err;
    }
  }

  const path = `/api/v1/backups/${id}/download/`;
  let res: Response;
  try {
    res = await apiFetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passphrase }),
    });
  } catch (err) {
    await writable?.abort();
    throw err;
  }
  if (!res.ok) {
    await writable?.abort();
    const { message, fields } = await extractApiError(res, path);
    throw new ApiError(message, res.status, fields);
  }

  if (writable && res.body) {
    // pipeTo closes the file on success and aborts it (discarding the
    // partial write) if the stream errors.
    await res.body.pipeTo(writable);
    return true;
  }

  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
  return true;
}
