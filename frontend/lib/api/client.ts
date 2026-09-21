import { refreshRequest } from "@/lib/api/auth";
import { redirectToLogin } from "@/lib/auth/redirect";
import { tokenStore } from "@/lib/auth/token-store";

// Empty by default (not just in dev) - the published prod image ships with
// no domain baked in at all, since docker-compose.prod.yml's bundled nginx
// (see nginx/templates/locations.inc.template) already proxies both `/api/`
// and `/` under the one external domain the frontend itself is served from,
// so a schemeless/hostless path here already resolves to the right place.
// Only set NEXT_PUBLIC_API_URL to an absolute origin (scheme+host, no /api
// suffix - the paths below already include it) when the frontend is reached
// through something other than that bundled nginx, e.g. bare `npm run dev`
// against a differently-hosted backend (see frontend/.env.example) - the
// docker-compose.yml dev default of http://localhost:8000 is exactly that.
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

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
  /** Field-level messages from a DRF serializer.is_valid(raise_exception=True)
   * 400 response (e.g. {"username": ["A user with that username already
   * exists."]}) - empty for a plain {"detail": "..."} error. Callers that
   * want to show an error next to a specific field (e.g. the Account/Register
   * pages' username input) use this instead of parsing `message`, which
   * stays a single flattened string for callers that just show one banner. */
  fields: Record<string, string>;

  constructor(message: string, status: number, fields: Record<string, string> = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.fields = fields;
  }
}

// DRF error bodies are either {"detail": "message"} (PermissionDenied, a
// plain-string ValidationError, throttling, ...) or a field-error dict like
// {"title": ["This field is required."], "non_field_errors": [...]} from
// serializer.is_valid(raise_exception=True) - this flattens either shape
// into one human-readable string (for callers that just show one banner)
// alongside the per-field breakdown (for callers that show inline errors),
// instead of the status-code-only message apiJson used to throw, which meant
// every backend validation/permission message (e.g. "Only a draft or
// in-review article can be published.") never reached the user.
// Shared by extractApiError (fetch Response) and apiUpload's XHR error path
// below - both end up with a parsed JSON body and a status, just from
// different transports.
function parseErrorBody(
  body: unknown,
  status: number,
  path: string,
): { message: string; fields: Record<string, string> } {
  // DRF's own exception_handler special-cases this: raising
  // rest_framework.exceptions.ValidationError("some message") - the
  // shape training/services.py (and every other app's services.py) uses for
  // a plain business-rule rejection like "A course with enrollments can't
  // be deleted" - wraps the string in a *bare* top-level JSON array
  // (["some message"]), not {"detail": "some message"}. That still passes
  // `typeof body === "object"` (arrays do in JS), so without this check it
  // silently fell through the field-dict branch below (Object.entries on an
  // array yields index->string pairs, and a string never satisfies the
  // Array.isArray(value) check) all the way to the generic fallback -
  // exactly the "every backend validation message reaches the user" gap
  // this function's own docstring says it fixed, just for this one shape.
  if (Array.isArray(body) && body.every((entry): entry is string => typeof entry === "string") && body.length > 0) {
    return { message: body.join(" "), fields: {} };
  }
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    if (typeof record.detail === "string") return { message: record.detail, fields: {} };
    const fields: Record<string, string> = {};
    for (const [key, value] of Object.entries(record)) {
      if (Array.isArray(value) && value.every((entry): entry is string => typeof entry === "string") && value.length > 0) {
        fields[key] = value.join(" ");
      }
    }
    const messages = Object.values(fields);
    if (messages.length > 0) return { message: messages.join(" "), fields };
  }
  return { message: `Request to ${path} failed with ${status}`, fields: {} };
}

export async function extractApiError(
  res: Response,
  path: string,
): Promise<{ message: string; fields: Record<string, string> }> {
  try {
    const body: unknown = await res.json();
    return parseErrorBody(body, res.status, path);
  } catch {
    // Response body wasn't JSON (or was empty) - fall through to the generic message.
    return { message: `Request to ${path} failed with ${res.status}`, fields: {} };
  }
}

export async function apiJson<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await apiFetch(path, options);
  if (!res.ok) {
    const { message, fields } = await extractApiError(res, path);
    throw new ApiError(message, res.status, fields);
  }
  return res.json() as Promise<T>;
}

/** For endpoints with no response body worth parsing (204 deletes, etc.) -
 * still throws on failure, unlike calling apiFetch directly and ignoring the
 * result, which silently treats e.g. a 403 as a successful delete. */
export async function apiVoid(path: string, options: RequestInit = {}): Promise<void> {
  const res = await apiFetch(path, options);
  if (!res.ok) {
    const { message, fields } = await extractApiError(res, path);
    throw new ApiError(message, res.status, fields);
  }
}

/** Same auth/refresh-retry/error-shape contract as apiJson, but over
 * XMLHttpRequest instead of fetch - fetch has no cross-browser way to report
 * upload progress, while XHR's `upload.onprogress` does. Only worth the
 * extra transport for large-file POSTs that show a progress bar; everything
 * else should keep using apiJson. `onProgress` receives a 0-1 fraction. */
export function apiUpload<T>(
  path: string,
  formData: FormData,
  onProgress?: (fraction: number) => void,
  _retried = false,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_URL}${path}`);
    xhr.withCredentials = true;
    const token = tokenStore.getAccessToken();
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);

    xhr.upload.onprogress = (e) => {
      if (onProgress && e.lengthComputable) onProgress(e.loaded / e.total);
    };

    xhr.onload = () => {
      if (xhr.status === 401 && !_retried) {
        ensureFreshToken()
          .then(() => resolve(apiUpload<T>(path, formData, onProgress, true)))
          .catch(reject);
        return;
      }
      let body: unknown = null;
      try {
        body = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch {
        // Non-JSON body - body stays null, handled below either way.
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(body as T);
        return;
      }
      const { message, fields } = parseErrorBody(body, xhr.status, path);
      reject(new ApiError(message, xhr.status, fields));
    };

    xhr.onerror = () => reject(new ApiError(`Request to ${path} failed`, 0));

    xhr.send(formData);
  });
}
