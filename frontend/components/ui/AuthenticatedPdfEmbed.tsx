"use client";

import { useEffect, useState } from "react";

import { fetchBlobUrl, getCachedBlobUrlSync } from "@/lib/cache/blobCache";

import { PdfViewer } from "./PdfViewer";

interface AuthenticatedPdfEmbedProps {
  /** Path under the API, e.g. "/api/v1/files/<id>/download/" - not a public URL. */
  src: string;
  title: string;
  className?: string;
}

export function AuthenticatedPdfEmbed({ src, title, className }: AuthenticatedPdfEmbedProps) {
  const [result, setResult] = useState<{ src: string; url: string | null } | null>(() => {
    const cached = getCachedBlobUrlSync(src);
    return cached ? { src, url: cached } : null;
  });

  useEffect(() => {
    if (!src || !src.trim()) return;
    if (result?.src === src && result.url) return;

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

  if (!current?.url) {
    return <div className={`animate-pulse bg-surface-variant ${className ?? ""}`} />;
  }

  return <PdfViewer url={current.url} title={title} className={className} />;
}
