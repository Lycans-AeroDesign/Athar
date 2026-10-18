import { apiFetch, apiJson, apiVoid, extractApiError } from "./client";
import type { User, UserPreferences } from "./types";

export function updateMe(payload: {
  username?: string | null;
  first_name?: string;
  last_name?: string;
  title?: string;
  preferences?: UserPreferences;
  email_visible?: boolean;
  profile_picture_id?: string | null;
}): Promise<User> {
  return apiJson<User>("/api/v1/auth/me/", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

/** Downloads everything Athar holds about the current user as a JSON file (a blob: URL, since a
 * plain <a href> can't carry the Bearer header). */
export async function downloadMyData(): Promise<void> {
  const path = "/api/v1/auth/me/export/";
  const res = await apiFetch(path);
  if (!res.ok) throw new Error((await extractApiError(res, path)).message);
  const objectUrl = URL.createObjectURL(await res.blob());
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = `athar-my-data-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
}

/** Permanently deletes the current user's own account; the password is re-checked server-side. */
export function deleteMyAccount(password: string): Promise<void> {
  return apiVoid("/api/v1/auth/me/delete/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
}
