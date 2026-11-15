import { apiUrl } from "@/lib/api/client";
import { tokenStore } from "@/lib/auth/token-store";

/** Sends errors caught in the browser to the platform error log
 * (backend platform_admin ErrorReportView, readable by platform admins only).
 * Deliberately plain fetch, not apiFetch: a failed report must never trigger a
 * token refresh, a login redirect, or a report about itself. */

const MAX_REPORTS_PER_PAGE_LOAD = 20;
const sent = new Set<string>();

// Noise that isn't a bug in this app: browser-extension scripts, the benign
// ResizeObserver warning, and cross-origin "Script error." with no detail.
function isNoise(message: string, stack: string): boolean {
  return (
    /(chrome|moz|safari(-web)?)-extension:\/\//.test(stack) ||
    message.startsWith("ResizeObserver loop") ||
    (message === "Script error." && !stack)
  );
}

export function reportError(error: unknown, extra: { componentStack?: string } = {}): void {
  if (typeof window === "undefined") return;
  const err = error instanceof Error ? error : null;
  const name = err?.name ?? "";
  const message = (err?.message ?? String(error ?? "")).slice(0, 4000) || "(no message)";
  const stack = (err?.stack ?? "").slice(0, 20000);
  if (isNoise(message, stack)) return;

  const key = `${name}|${message}|${stack.slice(0, 500)}`;
  if (sent.has(key) || sent.size >= MAX_REPORTS_PER_PAGE_LOAD) return;
  sent.add(key);

  const body = JSON.stringify({
    name: name.slice(0, 200),
    message,
    stack,
    component_stack: (extra.componentStack ?? "").slice(0, 20000),
    url: window.location.href.slice(0, 2000),
  });
  const send = (withAuth: boolean) => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const token = withAuth ? tokenStore.getAccessToken() : null;
    if (token) headers.Authorization = `Bearer ${token}`;
    return fetch(apiUrl("/api/v1/platform/errors/report/"), { method: "POST", headers, body, keepalive: true });
  };
  // An expired access token gets a 401 even on this open endpoint - resend
  // anonymously rather than lose the report.
  send(true)
    .then((res) => (res.status === 401 ? send(false) : res))
    .catch(() => {
      // Nowhere left to report to.
    });
}
