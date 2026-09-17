"use client";

import { useTranslations } from "next-intl";
import { useRef, useState, type DragEvent, type KeyboardEvent } from "react";

import { Icon } from "./Icon";
import { IconButton } from "./IconButton";
import { ProgressBar } from "./ProgressBar";

interface FileDropzoneProps {
  onFileSelected: (file: File) => void;
  /** Omit to hide the remove affordance entirely (e.g. Attachments/a lesson's
   * resource list, which remove a file via its own list row instead - only a
   * single-slot box like DocumentEditor's needs this). */
  onRemove?: () => void;
  removeLabel?: string;
  disabled?: boolean;
  /** 0-1 while an upload is in flight; omit/null when idle. */
  progress?: number | null;
  /** The current file's name, for a box that represents a single persistent
   * slot (e.g. DocumentEditor's one primary file) rather than an "add
   * another" trigger (e.g. Attachments' list, a lesson's resource list) -
   * omit/null for the latter, where the box always shows its empty state. */
  fileName?: string | null;
  label: string;
  className?: string;
}

// Generic-file counterpart to PhotoDropzone.tsx - same click-or-drop box and
// in-box hint, but no image preview (the file can be any type), no
// accept="image/*" restriction, and no unsupported-type rejection since any
// file is valid here.
export function FileDropzone({
  onFileSelected,
  onRemove,
  removeLabel,
  disabled,
  progress,
  fileName,
  label,
  className,
}: FileDropzoneProps) {
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
    const file = e.dataTransfer.files[0];
    if (file) onFileSelected(file);
  }

  return (
    <div className={`relative ${className ?? ""}`}>
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        aria-disabled={disabled || undefined}
        onClick={openPicker}
        onKeyDown={handleKeyDown}
        onDragOver={handleDragOver}
        onDragEnter={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`group relative flex items-center gap-3 rounded-xl border px-4 py-3 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface ${
          isDraggingOver
            ? "border-primary ring-2 ring-primary ring-offset-2 ring-offset-surface bg-surface-container-low"
            : "border-dashed border-outline-variant hover:border-primary bg-surface-container-low"
        } ${interactive ? "cursor-pointer" : "cursor-not-allowed opacity-60"}`}
      >
        <Icon name={fileName ? "description" : "upload_file"} size={20} className="text-on-surface-variant shrink-0" />
        <div className="min-w-0 flex-1">
          {fileName ? (
            <>
              <p className="font-body-md text-body-md text-on-surface truncate">{fileName}</p>
              <p className="font-body-md text-body-md text-on-surface-variant">{t("changePhoto")}</p>
            </>
          ) : (
            <p className="font-body-md text-body-md text-on-surface-variant">{t("dragDropFileHint")}</p>
          )}
        </div>

        {uploading && (
          <span className="absolute inset-0 flex items-center gap-3 rounded-xl bg-surface/90 px-4">
            <ProgressBar progress={progress ?? 0} className="flex-1" />
            <span className="font-label-caps text-label-caps text-on-surface-variant shrink-0">
              {Math.round((progress ?? 0) * 100)}%
            </span>
          </span>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        className="hidden"
        disabled={disabled}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFileSelected(file);
          e.target.value = "";
        }}
      />

      {fileName && onRemove && !uploading && (
        <IconButton
          icon="close"
          variant="secondary"
          size={16}
          aria-label={removeLabel ?? t("removeFile")}
          disabled={disabled}
          onClick={onRemove}
          className="absolute -top-3 -end-3 h-8 w-8 p-0 bg-surface shadow-[0_1px_4px_0_rgba(0,0,0,0.2)]"
        />
      )}
    </div>
  );
}
