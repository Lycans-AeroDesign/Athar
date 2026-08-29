"use client";

import { useTranslations } from "next-intl";
import { useRef, useState } from "react";

import { Icon } from "./Icon";
import { Markdown } from "./Markdown";

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

  function focusSelection(start: number, end: number) {
    const textarea = textareaRef.current;
    if (!textarea) return;
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(start, end);
    });
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
      {tab === "edit" ? (
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
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
