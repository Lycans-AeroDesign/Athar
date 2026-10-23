import { ApiError, apiFetch, apiJson, apiUpload } from "./client";
import type { StoredFileRef } from "./types";

interface UploadFileOptions {
  requiredPermission?: string;
  /** Reports upload progress as a 0-1 fraction, from the browser's actual
   * XHR upload.onprogress events - not a simulated/fake bar. */
  onProgress?: (fraction: number) => void;
}

/** Fallback while the real per-org limit is loading (or if the settings
 * fetch fails) - matches backend/config/settings.py's MAX_UPLOAD_SIZE_MB. */
export const DEFAULT_UPLOAD_LIMIT_MB = 2;

let uploadLimitMbPromise: Promise<number> | null = null;

/** The org's generic-upload limit (MB), fetched once and cached for the
 * session. Uses the public settings endpoint, so it resolves identically
 * pre- and post-login. Cached values don't update automatically after an
 * admin changes it mid-session - call clearUploadLimitCache() after a save
 * (IdentitySettingsForm does). */
export function getUploadLimitMb(): Promise<number> {
  uploadLimitMbPromise ??= apiJson<{ effective_max_upload_size_mb: number }>(
    "/api/v1/organization/settings/",
  )
    .then((settings) => settings.effective_max_upload_size_mb)
    .catch(() => DEFAULT_UPLOAD_LIMIT_MB);
  return uploadLimitMbPromise;
}

export function clearUploadLimitCache(): void {
  uploadLimitMbPromise = null;
}

/** Client-side counterpart of the backend's size check, thrown *before*
 * any upload starts - previously the whole file streamed to the server
 * (progress bar to 100%) only for the serializer to then reject it with
 * "File too large". Throw shape mirrors DRF's {"file": ["message"]} so
 * every existing error-handling path displays it unchanged. */
export async function assertFileWithinUploadLimit(file: File): Promise<void> {
  const limitMb = await getUploadLimitMb();
  if (file.size > limitMb * 1024 * 1024) {
    const message = `File too large (${(file.size / (1024 * 1024)).toFixed(1)}MB) - the limit is ${limitMb}MB.`;
    throw new ApiError(message, 413, { file: message });
  }
}

export async function uploadFile(file: File, options: UploadFileOptions = {}): Promise<StoredFileRef> {
  const { requiredPermission = "file.read", onProgress } = options;
  // Nothing over the org's limit is ever sent - the request builder below
  // (and the browser's own XHR) run only after this check has passed.
  await assertFileWithinUploadLimit(file);
  const formData = new FormData();
  formData.append("file", file);
  formData.append("required_permission", requiredPermission);
  // No Content-Type header - the browser sets the multipart boundary itself.
  // apiUpload's error handling already covers DRF's {"file": ["message"]}
  // shape (see files/serializers.py's validate_file, e.g. the size-limit
  // check), so no need to duplicate that extraction here.
  return apiUpload<StoredFileRef>("/api/v1/files/upload/", formData, onProgress);
}

/** Downloads a file through the auth-gated endpoint (see backend/files/views.py) and
 * triggers a browser save - a plain <a href> can't work here since the endpoint
 * requires a Bearer header. Mirrors AuthenticatedImage.tsx's blob: URL approach. */
export async function downloadFile(fileId: string, filename: string): Promise<void> {
  const res = await apiFetch(`/api/v1/files/${fileId}/download/`);
  if (!res.ok) throw new Error(`Failed to download file (${res.status})`);
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
