"use client";

import { useEffect, useState } from "react";

import { apiFetch } from "@/lib/api/client";

interface AuthenticatedImageProps {
  /** Path under the API, e.g. "/api/v1/files/<id>/download/" - not a public URL. */
  src: string;
  alt: string;
  className?: string;
}

// The file-serving endpoint is auth-gated (see backend/files/views.py), so it
// only accepts the Bearer token, which a plain <img src> can never send.
// This fetches the bytes through apiFetch (token attached, 401-refresh-retry
// included) and hands the browser a local blob: URL instead.
export function AuthenticatedImage({ src, alt, className }: AuthenticatedImageProps) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let currentUrl: string | null = null;

    apiFetch(src)
      .then((res) => (res.ok ? res.blob() : null))
      .then((blob) => {
        if (cancelled || !blob) return;
        currentUrl = URL.createObjectURL(blob);
        setObjectUrl(currentUrl);
      });

    return () => {
      cancelled = true;
      if (currentUrl) URL.revokeObjectURL(currentUrl);
    };
  }, [src]);

  if (!objectUrl) {
    return <div className={`animate-pulse bg-surface-variant ${className ?? ""}`} />;
  }

  // eslint-disable-next-line @next/next/no-img-element -- blob: URLs aren't supported by next/image's optimizer.
  return <img src={objectUrl} alt={alt} className={className} />;
}
