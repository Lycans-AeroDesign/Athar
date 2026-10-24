"use client";

import { useEffect, useState, type ReactNode } from "react";

import { fetchBlobUrl, getCachedBlobUrlSync } from "@/lib/cache/blobCache";

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
// This fetches the bytes through fetchBlobUrl (token attached, cached in memory
// and CacheStorage) and hands the browser a local blob: URL instead.
export function AuthenticatedImage({ src, alt, className, fallback }: AuthenticatedImageProps) {
  const [result, setResult] = useState<{ src: string; url: string | null } | null>(() => {
    const cached = getCachedBlobUrlSync(src);
    return cached ? { src, url: cached } : null;
  });

  useEffect(() => {
    if (!src || !src.trim()) {
      return;
    }

    if (result?.src === src && result.url) {
      return;
    }

    let cancelled = false;

    fetchBlobUrl(src)
      .then((url) => {
        if (!cancelled) {
          setResult({ src, url });
        }
      })
      .catch(() => {
        if (!cancelled) setResult({ src, url: null });
      });

    return () => {
      cancelled = true;
    };
  }, [src, result?.src, result?.url]);

  const current = result?.src === src ? result : null;

  if (!src || !src.trim()) {
    return fallback !== undefined ? fallback : null;
  }

  if (current?.url === null && fallback !== undefined) {
    return fallback;
  }

  if (!current?.url) {
    return <span className={`inline-block animate-pulse bg-surface-variant ${className ?? ""}`} />;
  }

  // eslint-disable-next-line @next/next/no-img-element -- blob: URLs aren't supported by next/image's optimizer.
  return <img src={current.url} alt={alt} className={className} />;
}
