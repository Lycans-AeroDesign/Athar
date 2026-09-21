"use client";

import { useEffect, useState } from "react";

import { apiFetch } from "@/lib/api/client";

interface AuthenticatedPdfEmbedProps {
  /** Path under the API, e.g. "/api/v1/files/<id>/download/" - not a public URL. */
  src: string;
  title: string;
  className?: string;
}

// Same auth-gated blob: URL fetch as AuthenticatedImage.tsx (the file-serving
// endpoint only accepts a Bearer token, which a plain <iframe src> can never
// send), but rendered via <iframe> - the browser's own built-in PDF viewer -
// instead of <img>. Used by training/LessonContent.tsx's DocumentResource so
// an uploaded PDF becomes the lesson's inline main content instead of just a
// download link, the same way a video resource embeds instead of linking out.
export function AuthenticatedPdfEmbed({ src, title, className }: AuthenticatedPdfEmbedProps) {
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

  if (!current?.url) {
    return <div className={`animate-pulse bg-surface-variant ${className ?? ""}`} />;
  }

  return <iframe src={current.url} title={title} className={`border-0 ${className ?? ""}`} />;
}
