"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { Icon } from "./Icon";
import { Markdown } from "./Markdown";
import { uploadFile } from "@/lib/api/files";

interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

// Textarea + a toolbar that inserts/wraps markdown syntax at the current
// selection, plus an Edit/Preview tab toggle - not a WYSIWYG editor, since
// the content model is markdown source (see Markdown.tsx). No "Underline"
// button: CommonMark/GFM has no underline syntax, and rendering raw <u> HTML
// would need rehype-raw (and then sanitizing untrusted user content against
// XSS) - not worth it for one button.
export function MarkdownEditor({ value, onChange, placeholder }: MarkdownEditorProps) {
  const t = useTranslations("knowledge.editor");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [tab, setTab] = useState<"edit" | "preview">("edit");
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Mirrors `value` synchronously (the prop only catches up once the parent
  // re-renders) so a chain of uploads - each awaiting the network before
  // editing the text again - always finds/replaces against the latest
  // content instead of a stale snapshot from when the upload started.
  const valueRef = useRef(value);
  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  function focusSelection(start: number, end: number) {
    const textarea = textareaRef.current;
    if (!textarea) return;
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(start, end);
    });
  }

  // Inserts an "Uploading…" placeholder at insertPos immediately, then
  // swaps it for the real markdown reference once uploadFile() resolves (or
  // removes it and surfaces uploadError on failure) - the placeholder text
  // itself is the only thing identifying which upload owns which spot in
  // the content, so its "uploading:<id>" fake URL just needs to be unique
  // per call, not meaningful.
  async function uploadAndInsert(file: File, insertPos: number, isImage: boolean): Promise<number> {
    const label = t(isImage ? "uploadingImage" : "uploadingFile", { filename: file.name });
    const uploadId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const placeholderText = `${isImage ? "!" : ""}[${label}](uploading:${uploadId})`;

    const withPlaceholder =
      valueRef.current.slice(0, insertPos) + placeholderText + valueRef.current.slice(insertPos);
    valueRef.current = withPlaceholder;
    onChange(withPlaceholder);
    const cursor = insertPos + placeholderText.length;
    focusSelection(cursor, cursor);

    try {
      const uploaded = await uploadFile(file);
      const finalText = `${isImage ? "!" : ""}[${file.name}](${uploaded.download_url})`;
      const current = valueRef.current;
      const next = current.includes(placeholderText)
        ? current.replace(placeholderText, finalText)
        : `${current}\n${finalText}`;
      valueRef.current = next;
      onChange(next);
      return insertPos + finalText.length;
    } catch (err) {
      const current = valueRef.current;
      const next = current.includes(placeholderText) ? current.replace(placeholderText, "") : current;
      valueRef.current = next;
      onChange(next);
      setUploadError(
        t("uploadError", { filename: file.name, message: err instanceof Error ? err.message : String(err) }),
      );
      return insertPos;
    }
  }

  // One file at a time (a multi-file paste/drop still resolves in order),
  // each separated by a blank line once more than one is involved.
  async function uploadFilesAtCursor(files: File[], startPos: number, imagesOnly: boolean) {
    setUploadError(null);
    let pos = startPos;
    let isFirst = true;
    for (const file of files) {
      const isImage = file.type.startsWith("image/");
      if (imagesOnly && !isImage) continue;
      if (!isFirst) {
        const withSeparator = valueRef.current.slice(0, pos) + "\n\n" + valueRef.current.slice(pos);
        valueRef.current = withSeparator;
        onChange(withSeparator);
        pos += 2;
      }
      isFirst = false;
      pos = await uploadAndInsert(file, pos, isImage);
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith("image/"));
    if (files.length === 0) return; // plain text paste - let the browser handle it normally.
    e.preventDefault();
    void uploadFilesAtCursor(files, e.currentTarget.selectionStart, true);
  }

  function handleDragOver(e: React.DragEvent<HTMLTextAreaElement>) {
    if (e.dataTransfer.types.includes("Files")) e.preventDefault();
  }

  function handleDrop(e: React.DragEvent<HTMLTextAreaElement>) {
    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return; // e.g. dragging selected text within the page - let the browser handle it.
    e.preventDefault();
    void uploadFilesAtCursor(files, e.currentTarget.selectionStart, false);
  }

  function wrapSelection(before: string, after: string, placeholderText: string) {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const { selectionStart, selectionEnd } = textarea;
    const selected = value.slice(selectionStart, selectionEnd);
    const inserted = selected || placeholderText;
    const next = value.slice(0, selectionStart) + before + inserted + after + value.slice(selectionEnd);
    onChange(next);
    const selStart = selectionStart + before.length;
    focusSelection(selStart, selStart + inserted.length);
  }

  function applyBulletedList() {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const { selectionStart, selectionEnd } = textarea;
    const selected = value.slice(selectionStart, selectionEnd) || t("listItemPlaceholder");
    const prefixed = selected
      .split("\n")
      .map((line) => `- ${line}`)
      .join("\n");
    const next = value.slice(0, selectionStart) + prefixed + value.slice(selectionEnd);
    onChange(next);
    focusSelection(selectionStart, selectionStart + prefixed.length);
  }

  function applyNumberedList() {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const { selectionStart, selectionEnd } = textarea;
    const selected = value.slice(selectionStart, selectionEnd) || t("listItemPlaceholder");
    const prefixed = selected
      .split("\n")
      .map((line, i) => `${i + 1}. ${line}`)
      .join("\n");
    const next = value.slice(0, selectionStart) + prefixed + value.slice(selectionEnd);
    onChange(next);
    focusSelection(selectionStart, selectionStart + prefixed.length);
  }

  function applyCode() {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const { selectionStart, selectionEnd } = textarea;
    const selected = value.slice(selectionStart, selectionEnd);
    if (selected.includes("\n")) {
      wrapSelection("```\n", "\n```", t("codePlaceholder"));
    } else {
      wrapSelection("`", "`", t("codePlaceholder"));
    }
  }

  function applyTable() {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const { selectionStart } = textarea;
    const template = "\n| Column 1 | Column 2 |\n| --- | --- |\n| Value | Value |\n";
    const next = value.slice(0, selectionStart) + template + value.slice(selectionStart);
    onChange(next);
    focusSelection(selectionStart + template.length, selectionStart + template.length);
  }

  const buttonClass =
    "p-1.5 rounded-lg text-on-surface-variant hover:bg-surface-variant transition-colors disabled:opacity-40 disabled:cursor-not-allowed";

  return (
    <div className="border border-outline-variant rounded-xl overflow-hidden bg-surface">
      <div className="flex items-center justify-between border-b border-outline-variant bg-surface-container">
        <div className="flex items-center gap-1 px-2 py-1.5">
          <button
            type="button"
            onClick={() => wrapSelection("**", "**", t("boldPlaceholder"))}
            disabled={tab === "preview"}
            aria-label={t("boldTooltip")}
            title={t("boldTooltip")}
            className={buttonClass}
          >
            <Icon name="format_bold" size={18} />
          </button>
          <button
            type="button"
            onClick={() => wrapSelection("_", "_", t("italicPlaceholder"))}
            disabled={tab === "preview"}
            aria-label={t("italicTooltip")}
            title={t("italicTooltip")}
            className={buttonClass}
          >
            <Icon name="format_italic" size={18} />
          </button>
          <button
            type="button"
            onClick={applyBulletedList}
            disabled={tab === "preview"}
            aria-label={t("bulletedListTooltip")}
            title={t("bulletedListTooltip")}
            className={buttonClass}
          >
            <Icon name="format_list_bulleted" size={18} />
          </button>
          <button
            type="button"
            onClick={applyNumberedList}
            disabled={tab === "preview"}
            aria-label={t("numberedListTooltip")}
            title={t("numberedListTooltip")}
            className={buttonClass}
          >
            <Icon name="format_list_numbered" size={18} />
          </button>
          <button
            type="button"
            onClick={() => wrapSelection("[", "](url)", t("linkTextPlaceholder"))}
            disabled={tab === "preview"}
            aria-label={t("linkTooltip")}
            title={t("linkTooltip")}
            className={buttonClass}
          >
            <Icon name="link" size={18} />
          </button>
          <button
            type="button"
            onClick={() => wrapSelection("![", "](url)", t("imageAltPlaceholder"))}
            disabled={tab === "preview"}
            aria-label={t("imageTooltip")}
            title={t("imageTooltip")}
            className={buttonClass}
          >
            <Icon name="image" size={18} />
          </button>
          <button
            type="button"
            onClick={applyCode}
            disabled={tab === "preview"}
            aria-label={t("codeTooltip")}
            title={t("codeTooltip")}
            className={buttonClass}
          >
            <Icon name="code" size={18} />
          </button>
          <button
            type="button"
            onClick={applyTable}
            disabled={tab === "preview"}
            aria-label={t("tableTooltip")}
            title={t("tableTooltip")}
            className={buttonClass}
          >
            <Icon name="table_chart" size={18} />
          </button>
        </div>
        <div className="flex items-center gap-1 px-2">
          <button
            type="button"
            onClick={() => setTab("edit")}
            className={`px-3 py-1 rounded-lg font-label-caps text-label-caps uppercase transition-colors ${
              tab === "edit" ? "bg-surface-container-lowest text-primary" : "text-on-surface-variant"
            }`}
          >
            {t("editTab")}
          </button>
          <button
            type="button"
            onClick={() => setTab("preview")}
            className={`px-3 py-1 rounded-lg font-label-caps text-label-caps uppercase transition-colors ${
              tab === "preview" ? "bg-surface-container-lowest text-primary" : "text-on-surface-variant"
            }`}
          >
            {t("previewTab")}
          </button>
        </div>
      </div>
      {uploadError && (
        <p className="px-4 py-2 font-body-md text-body-md text-error border-b border-outline-variant" role="alert">
          {uploadError}
        </p>
      )}
      {tab === "edit" ? (
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onPaste={handlePaste}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          placeholder={placeholder}
          className="w-full min-h-[400px] p-4 bg-transparent font-mono-sm text-mono-sm text-on-surface resize-y outline-none"
        />
      ) : (
        <div className="min-h-[400px] p-4">
          {value ? (
            <Markdown content={value} />
          ) : (
            <p className="font-body-md text-body-md text-on-surface-variant">{placeholder}</p>
          )}
        </div>
      )}
    </div>
  );
}
