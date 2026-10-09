import { apiJson, apiVoid } from "./client";

/** The raw token is returned only here, once - the backend stores just its hash. */
export interface PasswordResetLink {
  token: string;
  expires_at: string;
  email: string;
}

/** Requires user.manage; not for yourself, a blocked user, or anyone with access you don't have. */
export function createPasswordResetLink(userId: string): Promise<PasswordResetLink> {
  return apiJson<PasswordResetLink>(`/api/v1/auth/users/${userId}/password-reset-link/`, { method: "POST" });
}

/** Public. The token goes in the POST body (never the URL) so it can't land in access logs.
 * Rejects with a 404 ApiError for an invalid, used, replaced or expired link. */
export function checkPasswordResetLink(token: string): Promise<{ email: string; expires_at: string }> {
  return apiJson("/api/v1/auth/password-reset/check/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
}

/** Public. A 400 ApiError carries the password rules that failed in `fields.password`. */
export function confirmPasswordReset(token: string, password: string): Promise<void> {
  return apiVoid("/api/v1/auth/password-reset/confirm/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, password }),
  });
}

/** The shareable link - the token rides in the URL fragment, which browsers
 * never send to the server, so it stays out of nginx/Next.js access logs. */
export function passwordResetUrl(origin: string, localizedPath: string, token: string): string {
  return `${origin}${localizedPath}#${token}`;
}
