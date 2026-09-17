"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Button } from "./Button";
import { Icon } from "./Icon";
import { apiFetch } from "@/lib/api/client";
import { downloadFile } from "@/lib/api/files";
import type { StoredFile } from "@/lib/api/types";

interface FilePreviewModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  file: StoredFile;
}

type PreviewKind = "image" | "pdf" | "video" | "audio" | "text" | "unsupported";

function kindFor(contentType: string): PreviewKind {
  if (contentType.startsWith("image/")) return "image";
  if (contentType === "application/pdf") return "pdf";
  if (contentType.startsWith("video/")) return "video";
  if (contentType.startsWith("audio/")) return "audio";
  if (contentType.startsWith("text/") || contentType === "application/json") return "text";
  return "unsupported";
}

type FetchedState =
  | { status: "failed" }
  | { status: "text"; text: string }
  | { status: "media"; kind: "image" | "pdf" | "video" | "audio"; url: string };

// Not built on Modal.tsx - that primitive is capped at max-w-md for
// form-style dialogs, too small for an image/PDF viewer. The file itself is
// auth-gated (see backend/files/views.py), so it's fetched via apiFetch and
// rendered from a blob: URL (or, for the plain-text kinds, the decoded text
// itself) - same constraint/approach as AuthenticatedImage.tsx.
export function FilePreviewModal({ open, onOpenChange, file }: FilePreviewModalProps) {
  const t = useTranslations("filePreview");
  const modalT = useTranslations("modal");
  const kind = kindFor(file.content_type);

  // Keyed by the file id it was fetched for (rather than reset with a
  // separate setState call at the top of the effect below) - same pattern as
  // AuthenticatedImage.tsx, which avoids the react-hooks/set-state-in-effect
  // lint rule flagging a synchronous setState at the start of an effect. A
  // `result` whose `key` doesn't match the current file is stale/loading.
  const [result, setResult] = useState<{ key: string } & FetchedState | null>(null);

  useEffect(() => {
    if (!open || kind === "unsupported") return;
    let cancelled = false;
    let objectUrl: string | null = null;
    const key = file.id;

    apiFetch(file.download_url)
      .then((res) => (res.ok ? res.blob() : Promise.reject(new Error(String(res.status)))))
      .then(async (blob) => {
        if (cancelled) return;
        if (kind === "text") {
          setResult({ key, status: "text", text: await blob.text() });
          return;
        }
        objectUrl = URL.createObjectURL(blob);
        setResult({ key, status: "media", kind, url: objectUrl });
      })
      .catch(() => {
        if (!cancelled) setResult({ key, status: "failed" });
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [open, kind, file.id, file.download_url]);

  const current = result?.key === file.id ? result : null;
  const state: { status: "loading" } | FetchedState =
    kind === "unsupported" ? { status: "failed" } : (current ?? { status: "loading" });

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-inverse-surface/40 z-40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[calc(100%-2rem)] max-w-4xl max-h-[90vh] flex flex-col overflow-hidden bg-surface-container-lowest border border-outline-variant rounded-xl shadow-[0_4px_16px_0_rgba(0,0,0,0.12)] focus:outline-none">
          <div className="flex items-center justify-between gap-4 p-4 border-b border-outline-variant shrink-0">
            <Dialog.Title className="font-headline-md text-headline-md text-on-surface truncate">
              {file.original_filename}
            </Dialog.Title>
            <div className="flex items-center gap-2 shrink-0">
              <Button variant="ghost" onClick={() => downloadFile(file.id, file.original_filename)}>
                <Icon name="download" size={16} />
                {t("downloadButton")}
              </Button>
              <Dialog.Close asChild>
                <button
                  aria-label={modalT("close")}
                  className="text-on-surface-variant hover:text-on-surface transition-colors p-1"
                >
                  <Icon name="close" />
                </button>
              </Dialog.Close>
            </div>
          </div>

          <div className="flex-1 min-h-[300px] overflow-auto p-4 flex items-center justify-center">
            {state.status === "loading" && (
              <p className="font-body-md text-body-md text-on-surface-variant">{t("loading")}</p>
            )}
            {state.status === "failed" && (
              <p className="font-body-md text-body-md text-on-surface-variant text-center max-w-sm">
                {t("noPreview")}
              </p>
            )}
            {state.status === "text" && (
              <pre className="w-full h-full overflow-auto font-mono-sm text-mono-sm text-on-surface whitespace-pre-wrap text-start">
                {state.text}
              </pre>
            )}
            {state.status === "media" && state.kind === "image" && (
              // eslint-disable-next-line @next/next/no-img-element -- blob: URLs aren't supported by next/image's optimizer.
              <img src={state.url} alt={file.original_filename} className="max-w-full max-h-[75vh] object-contain" />
            )}
            {state.status === "media" && state.kind === "pdf" && (
              <iframe src={state.url} title={file.original_filename} className="w-full h-[75vh] border-0" />
            )}
            {state.status === "media" && state.kind === "video" && (
              <video controls src={state.url} className="max-w-full max-h-[75vh]" />
            )}
            {state.status === "media" && state.kind === "audio" && <audio controls src={state.url} className="w-full" />}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
