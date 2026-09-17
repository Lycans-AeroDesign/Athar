"use client";

import { useTranslations } from "next-intl";
import { useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode } from "react";

import { AuthenticatedImage } from "./AuthenticatedImage";
import { Icon } from "./Icon";
import { IconButton } from "./IconButton";
import { ProgressBar } from "./ProgressBar";
import type { StoredFileRef } from "@/lib/api/types";

interface PhotoDropzoneProps {
  value: StoredFileRef | null;
  onFileSelected: (file: File) => void;
  onUnsupportedFile?: (file: File) => void;
  /** Omit to hide the remove affordance entirely (e.g. branding logo/favicon,
   * which only ever get replaced, never cleared). */
  onRemove?: () => void;
  removeLabel?: string;
  disabled?: boolean;
  /** 0-1 while an upload is in flight; omit/null when idle. */
  progress?: number | null;
  alt: string;
  /** Rendered instead of the empty-state hint when `value` is set but its
   * image fails to load (e.g. AuthenticatedImage's own fallback - initials
   * for an avatar) - passed straight through. */
  fallback?: ReactNode;
  shape?: "circle" | "square" | "wide";
  /** "contain" for logos/favicons where cropping a non-square image would
   * cut off part of the mark; "cover" (default) fills the box, cropping as
   * needed - right for photos of a physical thing (avatar, component). */
  fit?: "cover" | "contain";
  className?: string;
}

const SHAPE_ROUNDING: Record<NonNullable<PhotoDropzoneProps["shape"]>, string> = {
  circle: "rounded-full",
  square: "rounded-xl",
  wide: "rounded-xl",
};

// A single box that's both the image preview AND the drop target - clicking
// or dropping an image on it uploads, replacing the old layout's separate
// thumbnail + "Upload" button + a drag-drop hint stranded in its own caption
// line below everything. Empty, the hint lives inside the box itself; once a
// photo is set, hovering/focusing swaps in a "Change" overlay instead, so
// the capability stays visible either way rather than only being disoverable
// by already being mid-drag.
export function PhotoDropzone({
  value,
  onFileSelected,
  onUnsupportedFile,
  onRemove,
  removeLabel,
  disabled,
  progress,
  alt,
  fallback,
  shape = "square",
  fit = "cover",
  className,
}: PhotoDropzoneProps) {
  const t = useTranslations("common");
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const uploading = progress != null;
  const interactive = !disabled && !uploading;

  function openPicker() {
    if (interactive) inputRef.current?.click();
  }

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    openPicker();
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    if (!interactive || !e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    setIsDraggingOver(true);
  }

  function handleDragLeave(e: DragEvent<HTMLDivElement>) {
    // Ignore leave events into a child element - only clear the highlight
    // once the pointer actually exits the box.
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setIsDraggingOver(false);
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDraggingOver(false);
    if (!interactive) return;
    const files = Array.from(e.dataTransfer.files);
    const file = files.find((f) => f.type.startsWith("image/"));
    if (file) onFileSelected(file);
    else if (files.length > 0) onUnsupportedFile?.(files[0]);
  }

  return (
    <div className={`relative shrink-0 ${className ?? "h-32 w-32"}`}>
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-label={alt}
        aria-disabled={disabled || undefined}
        onClick={openPicker}
        onKeyDown={handleKeyDown}
        onDragOver={handleDragOver}
        onDragEnter={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`group relative flex h-full w-full items-center justify-center overflow-hidden border outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface ${SHAPE_ROUNDING[shape]} ${
          isDraggingOver
            ? "border-primary ring-2 ring-primary ring-offset-2 ring-offset-surface"
            : value
              ? "border-outline-variant"
              : "border-dashed border-outline-variant hover:border-primary bg-surface-container-low"
        } ${interactive ? "cursor-pointer" : "cursor-not-allowed opacity-60"}`}
      >
        {value && (
          <AuthenticatedImage
            src={value.download_url}
            alt={alt}
            className={`h-full w-full ${fit === "contain" ? "object-contain p-2" : "object-cover"}`}
            fallback={fallback}
          />
        )}

        {!uploading && value && (
          <span className="absolute inset-0 flex items-center justify-center gap-1 bg-inverse-surface/0 text-transparent transition-colors group-hover:bg-inverse-surface/50 group-hover:text-inverse-on-surface group-focus-visible:bg-inverse-surface/50 group-focus-visible:text-inverse-on-surface">
            <Icon name="upload" size={16} />
            <span className="font-label-caps text-label-caps uppercase">{t("changePhoto")}</span>
          </span>
        )}

        {!uploading && !value && (
          <span className="flex flex-col items-center gap-1 px-2 text-center text-on-surface-variant">
            <Icon name="image" size={20} />
            <span className="font-body-md text-body-md leading-tight">{t("dragDropImageHint")}</span>
          </span>
        )}

        {uploading && (
          <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-surface/85 px-3">
            <span className="font-label-caps text-label-caps text-on-surface-variant">
              {Math.round((progress ?? 0) * 100)}%
            </span>
            <ProgressBar progress={progress ?? 0} className="max-w-[80%]" />
          </span>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        disabled={disabled}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFileSelected(file);
          e.target.value = "";
        }}
      />

      {value && onRemove && !uploading && (
        <IconButton
          icon="close"
          variant="secondary"
          size={18}
          aria-label={removeLabel ?? t("removePhoto")}
          disabled={disabled}
          onClick={onRemove}
          className="absolute -top-3 -end-3 h-9 w-9 p-0 bg-surface shadow-[0_1px_4px_0_rgba(0,0,0,0.2)]"
        />
      )}
    </div>
  );
}
