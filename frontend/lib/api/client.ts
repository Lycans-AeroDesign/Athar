import { refreshRequest } from "@/lib/api/auth";
import { redirectToLogin } from "@/lib/auth/redirect";
import { tokenStore } from "@/lib/auth/token-store";

const API_URL = process.env.NEXT_PUBLIC_API_URL;

/** Absolute URL for a public, unauthenticated backend path (e.g. the org
 * logo/favicon) - for plain <img src>, which apiFetch's token attachment
 * doesn't apply to and isn't needed for. */
export function apiUrl(path: string): string {
  return `${API_URL}${path}`;
}

let refreshPromise: Promise<string> | null = null;

// Concurrent 401s all await this same promise, so exactly one
// POST /api/v1/auth/refresh/ ever fires at a time (single-flight).
async function ensureFreshToken(): Promise<string> {
  if (refreshPromise) return refreshPromise;

  refreshPromise = refreshRequest()
    .then(({ access }) => {
      tokenStore.setAccessToken(access);
      return access;
    })
    .catch((err) => {
      tokenStore.clearAccessToken();
      redirectToLogin();
      throw err;
    })
    .finally(() => {
      refreshPromise = null;
    });

  return refreshPromise;
}

export async function apiFetch(
  path: string,
  options: RequestInit = {},
  _retried = false,
): Promise<Response> {
  const token = tokenStore.getAccessToken();
  const headers = new Headers(options.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers,
    credentials: "include",
  });

  if (res.status === 401 && !_retried) {
    await ensureFreshToken();
    return apiFetch(path, options, true);
  }

  return res;
}

export async function apiJson<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await apiFetch(path, options);
  if (!res.ok) {
    throw new Error(`Request to ${path} failed with ${res.status}`);
  }
  return res.json() as Promise<T>;
}
