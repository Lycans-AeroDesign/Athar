import { apiFetch, apiJson } from "./client";
import type { StoredFileRef } from "./types";

export function uploadFile(file: File, requiredPermission = "file.read"): Promise<StoredFileRef> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("required_permission", requiredPermission);
  // No Content-Type header - the browser sets the multipart boundary itself.
  // apiJson's error handling already covers DRF's {"file": ["message"]}
  // shape (see files/serializers.py's validate_file, e.g. the size-limit
  // check), so no need to duplicate that extraction here.
  return apiJson<StoredFileRef>("/api/v1/files/upload/", { method: "POST", body: formData });
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
