"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { Icon } from "./Icon";

interface ImageLightboxProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  caption?: string;
  /** When supplied (e.g. previewing inside MarkdownEditor), surfaces a Crop button
   * beside the close button. */
  onCrop?: () => void;
  /** The enlarged image itself - passed in rather than a src so the caller
   * can reuse AuthenticatedImage for auth-gated files. */
  children: ReactNode;
}

// Full-screen click-to-zoom view for markdown images (see Markdown.tsx's
// ImageRenderer). Not built on Modal.tsx for the same reason as
// FilePreviewModal - that primitive is capped at max-w-md. The content layer
// covers the whole viewport, so Radix's own outside-click never fires;
// clicking the backdrop around the image closes it instead.
export function ImageLightbox({ open, onOpenChange, caption, onCrop, children }: ImageLightboxProps) {
  const t = useTranslations("modal");
  const markdownT = useTranslations("markdown");

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/85 z-40" />
        <Dialog.Content
          aria-describedby={undefined}
          onClick={(e) => {
            if (e.target === e.currentTarget) onOpenChange(false);
          }}
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 p-4 sm:p-10 focus:outline-none"
        >
          <Dialog.Title className="sr-only">{caption || t("imagePreview")}</Dialog.Title>
          <div className="absolute top-4 end-4 flex items-center gap-2">
            {onCrop && (
              <button
                type="button"
                onClick={() => {
                  onOpenChange(false);
                  onCrop();
                }}
                aria-label={markdownT("cropImage")}
                title={markdownT("cropImage")}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-black/60 text-white hover:bg-black/80 transition-colors text-label-md font-label-md"
              >
                <Icon name="crop" size={18} />
                <span>{markdownT("crop")}</span>
              </button>
            )}
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label={t("close")}
                title={t("close")}
                className="p-2 rounded-full bg-black/60 text-white hover:bg-black/80 transition-colors"
              >
                <Icon name="close" size={20} />
              </button>
            </Dialog.Close>
          </div>
          {children}
          {caption && <p className="max-w-3xl text-center font-body-md text-body-md text-white/90">{caption}</p>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
