import { refreshRequest } from "@/lib/api/auth";
import { redirectToLogin } from "@/lib/auth/redirect";
import { tokenStore } from "@/lib/auth/token-store";

// Empty by default: the prod image bakes in no domain, and its bundled nginx proxies `/api/` and
// `/` under one external domain, so a hostless path resolves correctly. Set NEXT_PUBLIC_API_URL
// to an absolute origin (no /api suffix) only when the frontend isn't behind that nginx, e.g.
// bare `npm run dev` against another backend (see frontend/.env.example; the docker-compose.yml
// dev default http://localhost:8000 is that case).
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

  if (res.status === 403) void notifyIfPolicyRequired(res.clone());

  return res;
}

/** Fired on `window` when any API call is refused because the user has a
 * policy to accept (e.g. an admin published a new version mid-session) -
 * PolicyGate listens for it and re-checks. */
export const POLICY_REQUIRED_EVENT = "athar:policy-acceptance-required";

/** The 403 body `code` for that - see backend/policies/authentication.py. */
export const POLICY_ACCEPTANCE_REQUIRED = "policy_acceptance_required";

async function notifyIfPolicyRequired(res: Response): Promise<void> {
  try {
    const body = await res.json();
    if (body?.code === POLICY_ACCEPTANCE_REQUIRED && typeof window !== "undefined") {
      window.dispatchEvent(new Event(POLICY_REQUIRED_EVENT));
    }
  } catch {
    // Not JSON - not a policy refusal.
  }
}

/** Thrown by apiJson/apiVoid (and loginRequest) so callers can branch on HTTP status, e.g. login
 * telling a 429 (rate-limited) from a 401 (wrong credentials). */
export class ApiError extends Error {
  status: number;
  /** Field-level messages from a DRF 400 (e.g. {"username": ["..."]}); empty for a plain
   * {"detail"} error. Use for inline field errors; `message` is the flattened banner string. */
  fields: Record<string, string>;

  constructor(message: string, status: number, fields: Record<string, string> = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.fields = fields;
  }
}

// DRF error bodies are {"detail": "..."} or a field-error dict; this flattens either into one
// banner string plus a per-field breakdown, so backend validation/permission messages reach the
// user. Shared by extractApiError (fetch) and apiUpload's XHR error path.
function parseErrorBody(
  body: unknown,
  status: number,
  path: string,
): { message: string; fields: Record<string, string> } {
  // DRF wraps a bare ValidationError("msg") (every services.py uses these for business-rule
  // rejections) as a top-level array ["msg"], not {"detail": "msg"}. Arrays pass
  // `typeof body === "object"`, so handle them explicitly or the message falls through to the
  // generic fallback.
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

/** Same auth/refresh-retry/error contract as apiJson, but over XMLHttpRequest because fetch can't
 * report upload progress. Use only for large uploads with a progress bar. `onProgress` receives
 * a 0-1 fraction. */
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
