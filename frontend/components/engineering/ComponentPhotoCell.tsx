"use client";

import { useEffect, useRef, useState } from "react";

import { apiFetch } from "@/lib/api/client";
import type { StoredFileRef } from "@/lib/api/types";

interface ComponentPhotoCellProps {
  photo: StoredFileRef;
  alt: string;
}

// Table-view counterpart to AuthenticatedImage.tsx - same auth-gated
// blob: URL fetch, but renders both a small thumbnail AND (revealed on
// hover) a larger preview from that one fetched blob, rather than mounting
// AuthenticatedImage twice and fetching the same file over the wire again
// for the hover preview.
export function ComponentPhotoCell({ photo, alt }: ComponentPhotoCellProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const cellRef = useRef<HTMLDivElement>(null);

  // Lazy: don't even issue the auth-gated request until this cell has
  // scrolled near the viewport - a full page of rows would otherwise fire
  // one download per row on mount regardless of what's actually on screen.
  // rootMargin starts the fetch a bit before the cell is actually visible,
  // so the thumbnail is usually ready by the time it scrolls into view.
  useEffect(() => {
    const node = cellRef.current;
    if (!node || isVisible) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setIsVisible(true);
      },
      { rootMargin: "200px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [isVisible]);

  useEffect(() => {
    if (!isVisible) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    apiFetch(photo.download_url)
      .then((res) => (res.ok ? res.blob() : null))
      .then((blob) => {
        if (cancelled || !blob) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [photo, isVisible]);

  if (!url) {
    return (
      <div
        ref={cellRef}
        className="flex h-9 w-9 items-center justify-center rounded-lg border border-outline-variant bg-surface-container-low"
      >
        {/* Same indeterminate-spinner construction as LoadingScreen.tsx - a
            plain bordered circle with one side colored and spun, no extra
            dependency for something this small. */}
        <span className="h-4 w-4 rounded-full border-2 border-outline-variant border-t-primary animate-spin" />
      </div>
    );
  }

  return (
    <div ref={cellRef} className="group/photo relative inline-block">
      {/* eslint-disable-next-line @next/next/no-img-element -- blob: URLs aren't supported by next/image's optimizer. */}
      <img src={url} alt={alt} className="h-9 w-9 rounded-lg object-cover border border-outline-variant" />
      <div className="pointer-events-none absolute start-0 top-full z-50 mt-1 origin-top opacity-0 scale-95 transition-all duration-150 group-hover/photo:opacity-100 group-hover/photo:scale-100">
        {/* max-h/max-w with auto width/height (not a fixed square box) - most
            component photos aren't square, and a fixed box with object-contain
            would letterbox them, making the actual visible image narrower
            than the box itself. This instead renders at the photo's own
            aspect ratio, just capped so it can't grow past 256px either way. */}
        {/* eslint-disable-next-line @next/next/no-img-element -- blob: URLs aren't supported by next/image's optimizer. */}
        <img
          src={url}
          alt={alt}
          className="h-auto w-auto max-h-64 max-w-64 rounded-xl object-contain border border-outline-variant shadow-[0_4px_16px_0_rgba(0,0,0,0.16)]"
        />
      </div>
    </div>
  );
}
