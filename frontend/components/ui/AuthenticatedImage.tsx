"use client";

import { useEffect, useState, type ReactNode } from "react";

import { apiFetch } from "@/lib/api/client";

interface AuthenticatedImageProps {
  /** Path under the API, e.g. "/api/v1/files/<id>/download/" - not a public URL. */
  src: string;
  alt: string;
  className?: string;
  /** Rendered instead of the loading skeleton once the fetch fails (403 for a
   * viewer without the file's required_permission, 404, network error, ...) -
   * without this, a failed fetch left the skeleton pulsing forever instead of
   * settling on some final state. Omit to keep that skeleton as the failure
   * state too (fine for e.g. branding previews an org admin uploaded themselves,
   * where a failure is unexpected rather than a routine permission gap). */
  fallback?: ReactNode;
}

// The file-serving endpoint is auth-gated (see backend/files/views.py), so it
// only accepts the Bearer token, which a plain <img src> can never send.
// This fetches the bytes through apiFetch (token attached, 401-refresh-retry
// included) and hands the browser a local blob: URL instead.
export function AuthenticatedImage({ src, alt, className, fallback }: AuthenticatedImageProps) {
  // Keyed by the `src` it was fetched for (rather than reset with a separate
  // setState call at the top of the effect below) - same pattern as
  // MarkdownEditor.tsx's mentionSearch state, which avoids the
  // react-hooks/set-state-in-effect lint rule flagging a synchronous
  // setState at the start of an effect. A `result` whose `src` doesn't match
  // the current prop is treated as stale/loading, not stale data.
  const [result, setResult] = useState<{ src: string; url: string | null } | null>(null);

  useEffect(() => {
    let cancelled = false;
    let currentUrl: string | null = null;

    apiFetch(src)
      .then((res) => (res.ok ? res.blob() : null))
      .then((blob) => {
        if (cancelled) return;
        if (blob) {
          currentUrl = URL.createObjectURL(blob);
          setResult({ src, url: currentUrl });
        } else {
          setResult({ src, url: null });
        }
      })
      .catch(() => {
        if (!cancelled) setResult({ src, url: null });
      });

    return () => {
      cancelled = true;
      if (currentUrl) URL.revokeObjectURL(currentUrl);
    };
  }, [src]);

  const current = result?.src === src ? result : null;

  if (current?.url === null && fallback !== undefined) {
    return fallback;
  }

  if (!current?.url) {
    // A <span>, not a <div>: this can render inside a markdown <p> (see
    // Markdown.tsx's img component), and a <div> there is invalid HTML -
    // React only warns about it during hydration, but Chrome's parser
    // silently closes the <p> early, breaking the DOM structure regardless.
    return <span className={`inline-block animate-pulse bg-surface-variant ${className ?? ""}`} />;
  }

  // eslint-disable-next-line @next/next/no-img-element -- blob: URLs aren't supported by next/image's optimizer.
  return <img src={current.url} alt={alt} className={className} />;
}
