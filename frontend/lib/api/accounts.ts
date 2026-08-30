import { apiJson } from "./client";
import type { User } from "./types";

export function updateMe(payload: { first_name?: string; last_name?: string; title?: string }): Promise<User> {
  return apiJson<User>("/api/v1/auth/me/", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}
