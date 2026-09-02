import { ApiError, extractApiError } from "./client";
import type { LoginResponse, User } from "./types";

const API_URL = process.env.NEXT_PUBLIC_API_URL;
const LOGIN_PATH = "/api/v1/auth/login/";
const REGISTER_PATH = "/api/v1/auth/register/";
const CREATE_ORGANIZATION_PATH = "/api/v1/organization/";

// Bare fetch rather than apiJson (no access token to attach yet, and a 401
// here must not trigger apiFetch's refresh-and-retry loop) - but still uses
// ApiError/extractApiError so the login page can tell a 429 (rate
// limited) apart from a 401 (wrong credentials) instead of always showing
// the same "invalid email or password" copy regardless of the real cause.
export async function loginRequest(email: string, password: string): Promise<LoginResponse> {
  const res = await fetch(`${API_URL}${LOGIN_PATH}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const { message, fields } = await extractApiError(res, LOGIN_PATH);
    throw new ApiError(message, res.status, fields);
  }
  return res.json();
}

// Creates the account only - it doesn't log the caller in (see backend/accounts/views.py's
// RegisterView, which returns UserSerializer data, not tokens), so callers
// follow up with loginRequest/AuthProvider.login using the same credentials.
export async function registerRequest(payload: {
  email: string;
  password: string;
  invitation_code: string;
  first_name?: string;
  last_name?: string;
  username?: string;
}): Promise<User> {
  const res = await fetch(`${API_URL}${REGISTER_PATH}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const { message, fields } = await extractApiError(res, REGISTER_PATH);
    throw new ApiError(message, res.status, fields);
  }
  return res.json();
}

// The self-service SaaS signup entrypoint - "create a new organization,"
// distinct from registerRequest ("join an existing one via an invitation
// code"). Same shape: creates the org + its first admin user, doesn't log
// the caller in (see backend/organization/views.py's OrganizationCreateView,
// which deliberately mirrors RegisterView's own "create, then log in
// separately" precedent).
export async function createOrganizationRequest(payload: {
  name: string;
  admin_email: string;
  admin_password: string;
  admin_first_name?: string;
  admin_last_name?: string;
  admin_username?: string;
}): Promise<User> {
  const res = await fetch(`${API_URL}${CREATE_ORGANIZATION_PATH}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const { message, fields } = await extractApiError(res, CREATE_ORGANIZATION_PATH);
    throw new ApiError(message, res.status, fields);
  }
  return res.json();
}

export async function logoutRequest(): Promise<void> {
  await fetch(`${API_URL}/api/v1/auth/logout/`, {
    method: "POST",
    credentials: "include",
  }).catch(() => {
    // Token store is cleared client-side regardless of network/server outcome.
  });
}

export async function refreshRequest(): Promise<{ access: string }> {
  const res = await fetch(`${API_URL}/api/v1/auth/refresh/`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) throw new Error("Refresh failed");
  return res.json();
}
