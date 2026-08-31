"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { Icon } from "./Icon";
import { Markdown } from "./Markdown";
import { searchKnowledge } from "@/lib/api/knowledge";
import { uploadFile } from "@/lib/api/files";
import type { SearchResult } from "@/lib/api/types";
import { RELATABLE_ICON, RELATABLE_ROUTE_PREFIX } from "@/lib/knowledgeTypes";

interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

// An "@" preceded by start-of-text/whitespace, followed by a run of
// non-whitespace up to the cursor, is a mention-in-progress - anywhere else
// (mid-word, an email address) it's just an "@" character.
function detectMention(text: string, cursor: number): { start: number; query: string } | null {
  const uptoCursor = text.slice(0, cursor);
  const atIndex = uptoCursor.lastIndexOf("@");
  if (atIndex === -1) return null;
  const query = uptoCursor.slice(atIndex + 1);
  if (/\s/.test(query)) return null;
  const charBefore = uptoCursor[atIndex - 1];
  if (charBefore !== undefined && !/\s/.test(charBefore)) return null;
  return { start: atIndex, query };
}

// Style properties that affect text layout/wrapping - copied onto a hidden
// mirror <div> so the text up to `position` wraps identically to the
// textarea, letting us read the caret's pixel offset off a marker <span>
// (a plain textarea exposes no such API itself).
const MIRRORED_STYLE_PROPS = [
  "boxSizing",
  "width",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "borderTopWidth",
  "borderRightWidth",
  "borderBottomWidth",
  "borderLeftWidth",
  "borderStyle",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "fontStyle",
  "letterSpacing",
  "lineHeight",
  "tabSize",
] as const;

function getCaretCoordinates(
  textarea: HTMLTextAreaElement,
  position: number,
): { top: number; left: number; height: number } {
  const mirror = document.createElement("div");
  const computed = getComputedStyle(textarea);
  for (const prop of MIRRORED_STYLE_PROPS) {
    mirror.style[prop] = computed[prop];
  }
  mirror.style.position = "absolute";
  mirror.style.visibility = "hidden";
  mirror.style.whiteSpace = "pre-wrap";
  mirror.style.wordWrap = "break-word";
  mirror.style.top = "0";
  mirror.style.left = "-9999px";

  mirror.textContent = textarea.value.slice(0, position);
  const marker = document.createElement("span");
  marker.textContent = textarea.value.slice(position) || ".";
  mirror.appendChild(marker);
  document.body.appendChild(mirror);
  const top = textarea.offsetTop + marker.offsetTop - textarea.scrollTop;
  const left = textarea.offsetLeft + marker.offsetLeft - textarea.scrollLeft;
  const height = marker.offsetHeight;
  document.body.removeChild(mirror);
  return { top, left, height };
}

// Textarea + a toolbar that inserts/wraps markdown syntax at the current
// selection, plus an Edit/Preview tab toggle - not a WYSIWYG editor, since
// the content model is markdown source (see Markdown.tsx). No "Underline"
// button: CommonMark/GFM has no underline syntax, and rendering raw <u> HTML
// would need rehype-raw (and then sanitizing untrusted user content against
// XSS) - not worth it for one button.
export function MarkdownEditor({ value, onChange, placeholder }: MarkdownEditorProps) {
  const t = useTranslations("knowledge.editor");
  const commonT = useTranslations("common");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [tab, setTab] = useState<"edit" | "preview">("edit");
  const [uploadError, setUploadError] = useState<string | null>(null);

  // "@"-mention picker: typing "@query" opens a dropdown searching across
  // every relatable type (searchKnowledge already covers all of them);
  // picking a result replaces "@query" with a real markdown link, so the
  // reference is just plain link syntax in the source, clickable in preview
  // - it does NOT create a KnowledgeRelation (that stays a separate, explicit
  // action via the "Related Knowledge" picker - see RelatedContent.tsx).
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  // Keyed by the query it was fetched for (rather than reset with a plain
  // setMentionResults([]) at the top of the search effect below) - see
  // knowledge/page.tsx's status-filter effect for why (that pattern runs
  // setState synchronously in the effect body, which React's lint rule flags).
  const [mentionSearch, setMentionSearch] = useState<{ query: string; results: SearchResult[] } | null>(null);
  const mentionResults = mention && mentionSearch?.query === mention.query.trim() ? mentionSearch.results : [];
  const [mentionSearching, setMentionSearching] = useState(false);
  const [mentionActiveIndex, setMentionActiveIndex] = useState(0);
  // The start offset of a mention the user explicitly dismissed with Escape,
  // so it doesn't immediately reopen on the next keystroke of that same "@".
  const [dismissedStart, setDismissedStart] = useState<number | null>(null);
  // Pixel position of the "@" itself, so the dropdown renders right beside
  // it instead of a fixed spot in the editor - recomputed only when a new
  // mention starts (not on every keystroke of the query, so the popup holds
  // still while typing).
  const [mentionCoords, setMentionCoords] = useState<{ top: number; left: number; height: number } | null>(null);

  // Mirrors `value` synchronously (the prop only catches up once the parent
  // re-renders) so a chain of uploads - each awaiting the network before
  // editing the text again - always finds/replaces against the latest
  // content instead of a stale snapshot from when the upload started.
  const valueRef = useRef(value);
  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!mention || !textarea) return;
    // Deferred a frame so layout (the just-typed "@" character) has painted
    // before measuring it - same rAF-after-paint pattern as focusSelection().
    const frame = requestAnimationFrame(() => {
      setMentionCoords(getCaretCoordinates(textarea, mention.start));
    });
    return () => cancelAnimationFrame(frame);
    // Only the mention's start offset matters here - re-running this on every
    // keystroke of mention.query (a new object each time) would make the
    // popup jitter/reposition while the user is still typing it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mention?.start]);

  useEffect(() => {
    const query = mention?.query.trim();
    if (!query) return;
    const handle = setTimeout(() => {
      setMentionSearching(true);
      searchKnowledge(query)
        .then((data) => {
          setMentionSearch({ query, results: data.results });
          setMentionActiveIndex(0);
        })
        .finally(() => setMentionSearching(false));
    }, 300);
    return () => clearTimeout(handle);
  }, [mention?.query]);

  function updateMentionFromCursor(text: string, cursor: number) {
    const detected = detectMention(text, cursor);
    setMention(detected && detected.start === dismissedStart ? null : detected);
  }

  function selectMention(result: SearchResult) {
    if (!mention) return;
    const end = mention.start + 1 + mention.query.length;
    const link = `[${result.title}](${RELATABLE_ROUTE_PREFIX[result.type]}/${result.id})`;
    const next = value.slice(0, mention.start) + link + value.slice(end);
    onChange(next);
    const cursor = mention.start + link.length;
    focusSelection(cursor, cursor);
    setMention(null);
  }

  function handleMentionKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (!mention) return;
    if (e.key === "Escape") {
      e.preventDefault();
      setDismissedStart(mention.start);
      setMention(null);
      return;
    }
    if (mentionResults.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setMentionActiveIndex((i) => (i + 1) % mentionResults.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setMentionActiveIndex((i) => (i - 1 + mentionResults.length) % mentionResults.length);
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      selectMention(mentionResults[mentionActiveIndex]);
    }
  }

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

  // Clamped so the fixed-width popup never runs past the textarea's right
  // edge for a mention typed near the end of a long line.
  const mentionPopupWidth = 288;
  const mentionPopupLeft = mentionCoords
    ? Math.min(mentionCoords.left, Math.max(0, (textareaRef.current?.clientWidth ?? mentionPopupWidth) - mentionPopupWidth))
    : 0;

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
        <div className="relative">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => {
              onChange(e.target.value);
              updateMentionFromCursor(e.target.value, e.target.selectionStart);
            }}
            onSelect={(e) => updateMentionFromCursor(e.currentTarget.value, e.currentTarget.selectionStart)}
            onKeyDown={handleMentionKeyDown}
            onPaste={handlePaste}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            placeholder={placeholder}
            className="w-full min-h-[400px] p-4 bg-transparent font-mono-sm text-mono-sm text-on-surface resize-y outline-none"
          />
          {mention && mentionCoords && (
            <div
              className="absolute z-10 max-h-64 overflow-y-auto bg-surface-container-lowest border border-outline-variant rounded-lg shadow-[0_2px_8px_0_rgba(0,0,0,0.15)]"
              style={{ top: mentionCoords.top + mentionCoords.height, left: mentionPopupLeft, width: mentionPopupWidth }}
            >
              {mentionSearching ? (
                <p className="px-3 py-2 font-body-md text-body-md text-on-surface-variant">{t("mentionSearching")}</p>
              ) : !mention.query.trim() ? (
                <p className="px-3 py-2 font-body-md text-body-md text-on-surface-variant">{commonT("typeToSearch")}</p>
              ) : mentionResults.length === 0 ? (
                <p className="px-3 py-2 font-body-md text-body-md text-on-surface-variant">{commonT("noResultsFound")}</p>
              ) : (
                <ul className="py-1">
                  {mentionResults.map((result, i) => (
                    <li key={`${result.type}-${result.id}`}>
                      <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => selectMention(result)}
                        className={`flex w-full items-center gap-2 px-3 py-2 text-start transition-colors ${
                          i === mentionActiveIndex ? "bg-surface-variant" : "hover:bg-surface-variant"
                        }`}
                      >
                        <Icon name={RELATABLE_ICON[result.type]} size={16} className="text-on-surface-variant shrink-0" />
                        <span className="font-body-md text-body-md text-on-surface truncate">{result.title}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
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
