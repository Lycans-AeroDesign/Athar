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

/** Thrown by apiJson/apiVoid (and loginRequest) instead of a plain Error so
 * callers can branch on the HTTP status - e.g. the login page telling a 429
 * (rate-limited) apart from a 401 (wrong credentials) instead of showing the
 * same "invalid email or password" copy for both. */
export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

// DRF error bodies are either {"detail": "message"} (PermissionDenied, a
// plain-string ValidationError, throttling, ...) or a field-error dict like
// {"title": ["This field is required."], "non_field_errors": [...]} from
// serializer.is_valid(raise_exception=True) - this flattens either shape
// into one human-readable string instead of the status-code-only message
// apiJson used to throw, which meant every backend validation/permission
// message (e.g. "Only a draft or in-review article can be published.") never
// reached the user.
export async function extractErrorMessage(res: Response, path: string): Promise<string> {
  try {
    const body: unknown = await res.json();
    if (body && typeof body === "object") {
      const record = body as Record<string, unknown>;
      if (typeof record.detail === "string") return record.detail;
      const messages = Object.values(record)
        .flat()
        .filter((value): value is string => typeof value === "string");
      if (messages.length > 0) return messages.join(" ");
    }
  } catch {
    // Response body wasn't JSON (or was empty) - fall through to the generic message.
  }
  return `Request to ${path} failed with ${res.status}`;
}

export async function apiJson<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await apiFetch(path, options);
  if (!res.ok) {
    throw new ApiError(await extractErrorMessage(res, path), res.status);
  }
  return res.json() as Promise<T>;
}

/** For endpoints with no response body worth parsing (204 deletes, etc.) -
 * still throws on failure, unlike calling apiFetch directly and ignoring the
 * result, which silently treats e.g. a 403 as a successful delete. */
export async function apiVoid(path: string, options: RequestInit = {}): Promise<void> {
  const res = await apiFetch(path, options);
  if (!res.ok) {
    throw new ApiError(await extractErrorMessage(res, path), res.status);
  }
}
