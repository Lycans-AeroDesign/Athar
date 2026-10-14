"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

interface PdfViewerProps {
  /** A blob: (or same-origin) URL of the PDF - already fetched with auth. */
  url: string;
  title: string;
  className?: string;
}

// Why not just <iframe src={blobUrl}>: Chrome on Android (and most mobile
// browsers) has no built-in PDF viewer, so an iframe pointing at a PDF shows
// only a placeholder - a PDF icon, the blob URL's UUID and an "Open" button -
// no matter what MIME type the blob carries. Desktop browsers that report a
// native viewer (navigator.pdfViewerEnabled) still get the iframe, which keeps
// their search/zoom/print toolbar; everything else is rendered with pdf.js.
function subscribeNoop() {
  return () => {};
}

function hasNativePdfViewer(): boolean {
  if (typeof navigator === "undefined" || typeof window === "undefined") return false;
  // Touch-first devices report pdfViewerEnabled inconsistently (iOS Safari
  // says true but only renders the first page inside an iframe), so only
  // trust it on fine-pointer (mouse/trackpad) devices.
  const finePointer = window.matchMedia?.("(pointer: fine)").matches ?? false;
  return navigator.pdfViewerEnabled === true && finePointer;
}

export function PdfViewer({ url, title, className }: PdfViewerProps) {
  const native = useSyncExternalStore(subscribeNoop, hasNativePdfViewer, () => false);

  if (native) {
    return <iframe src={url} title={title} className={`border-0 ${className ?? ""}`} />;
  }
  return <PdfJsViewer url={url} title={title} className={className} />;
}

function PdfJsViewer({ url, title, className }: PdfViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [result, setResult] = useState<{ url: string; status: "done" | "failed" } | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let cancelled = false;
    let destroy: (() => void) | null = null;

    (async () => {
      // Imported lazily: pdf.js touches browser-only globals at module load,
      // and this keeps it out of the bundle for pages that never show a PDF.
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/build/pdf.worker.min.mjs",
        import.meta.url,
      ).toString();

      const task = pdfjs.getDocument({ url });
      destroy = () => void task.destroy();
      const doc = await task.promise;
      if (cancelled) return;

      container.replaceChildren();
      const cssWidth = Math.max(container.clientWidth, 200);
      const dpr = Math.min(window.devicePixelRatio || 1, 3);

      for (let n = 1; n <= doc.numPages; n++) {
        const page = await doc.getPage(n);
        if (cancelled) return;
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: (cssWidth / base.width) * dpr });

        const canvas = document.createElement("canvas");
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = "100%";
        canvas.style.height = "auto";
        canvas.className = "block bg-white shadow-sm";
        canvas.setAttribute("aria-label", `${title} - ${n}/${doc.numPages}`);
        container.appendChild(canvas);

        await page.render({ canvas, viewport }).promise;
        page.cleanup();
      }
      if (!cancelled) setResult({ url, status: "done" });
    })().catch(() => {
      if (!cancelled) setResult({ url, status: "failed" });
    });

    return () => {
      cancelled = true;
      destroy?.();
    };
  }, [url, title]);

  const current = result?.url === url ? result : null;

  return (
    <div className={`overflow-auto ${className ?? ""}`}>
      {current?.status === "failed" ? (
        <div className="flex h-full items-center justify-center p-4">
          <a href={url} download={title} className="text-primary underline">
            {title}
          </a>
        </div>
      ) : (
        <div ref={containerRef} className="flex flex-col gap-3" aria-busy={!current} title={title} />
      )}
    </div>
  );
}
