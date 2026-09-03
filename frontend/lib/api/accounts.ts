import { apiJson } from "./client";
import type { User, UserPreferences } from "./types";

export function updateMe(payload: {
  username?: string | null;
  first_name?: string;
  last_name?: string;
  title?: string;
  preferences?: UserPreferences;
  profile_picture_id?: string | null;
}): Promise<User> {
  return apiJson<User>("/api/v1/auth/me/", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}
