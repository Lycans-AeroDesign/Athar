import { apiFetch, apiUpload } from "./client";
import type { StoredFileRef } from "./types";

interface UploadFileOptions {
  requiredPermission?: string;
  /** Reports upload progress as a 0-1 fraction, from the browser's actual
   * XHR upload.onprogress events - not a simulated/fake bar. */
  onProgress?: (fraction: number) => void;
}

export function uploadFile(file: File, options: UploadFileOptions = {}): Promise<StoredFileRef> {
  const { requiredPermission = "file.read", onProgress } = options;
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
