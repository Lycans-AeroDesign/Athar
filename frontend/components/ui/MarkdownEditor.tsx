"use client";

import * as Popover from "@radix-ui/react-popover";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { Icon } from "./Icon";
import { Markdown } from "./Markdown";
import { Link } from "@/i18n/navigation";
import { errorMessage } from "@/lib/errors";
import { CALLOUT_TYPES, type CalloutType } from "@/lib/markdownCallouts";
import { updateMe } from "@/lib/api/accounts";
import { createRelation, searchKnowledge } from "@/lib/api/knowledge";
import { uploadFile } from "@/lib/api/files";
import type { RelatableType, SearchResult } from "@/lib/api/types";
import { useAuth } from "@/lib/auth/AuthProvider";
import { RELATABLE_ICON, RELATABLE_ROUTE_PREFIX } from "@/lib/knowledgeTypes";

interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** The item this content belongs to, e.g. { type: "article", id: article.id } - when set,
   * picking an "@"-mention also links the two as Related Knowledge (see selectMention), not
   * just inserting link text. Omitted while creating a new (unsaved, id-less) item. */
  relateFrom?: { type: RelatableType; id: string };
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

const MENTION_POPUP_WIDTH = 288;

// Only needs to be unique per upload - see uploadAndInsert's placeholder.
function newUploadId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const TOOLBAR_BUTTON_CLASS =
  "p-1.5 rounded-lg text-on-surface-variant hover:bg-surface-variant transition-colors disabled:opacity-40 disabled:cursor-not-allowed";

function ToolButton({
  icon,
  tooltip,
  onClick,
  disabled,
}: {
  icon: string;
  tooltip: string;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={tooltip}
      title={tooltip}
      className={TOOLBAR_BUTTON_CLASS}
    >
      <Icon name={icon} size={18} />
    </button>
  );
}

function ToolbarSeparator() {
  return <div className="w-px h-5 bg-outline-variant mx-1" aria-hidden="true" />;
}

// Textarea + a toolbar that inserts/wraps markdown syntax at the current
// selection, plus an Edit/Preview tab toggle - not a WYSIWYG editor, since
// the content model is markdown source (see Markdown.tsx). No "Underline"
// button: CommonMark/GFM has no underline syntax, and rendering raw <u> HTML
// would need rehype-raw (and then sanitizing untrusted user content against
// XSS) - not worth it for one button.
export function MarkdownEditor({ value, onChange, placeholder, relateFrom }: MarkdownEditorProps) {
  const t = useTranslations("knowledge.editor");
  const commonT = useTranslations("common");
  const markdownT = useTranslations("markdown");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [tab, setTab] = useState<"edit" | "preview">("edit");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [relationError, setRelationError] = useState<string | null>(null);
  const [calloutMenuOpen, setCalloutMenuOpen] = useState(false);

  // Formatting tips popover: opens itself once per user (like the product tour's
  // has_completed_tour) so it's discoverable, then behaves as a normal click-to-open popover. The
  // lazy initializer (not an effect-driven setState, which react-hooks flags) reads
  // has_seen_markdown_help once at mount; safe because every route rendering this is behind the
  // protected layout's `!user` loading check, so `user` is already resolved.
  const { user, updateUser } = useAuth();
  const [helpOpen, setHelpOpen] = useState(() => Boolean(user && !user.preferences.has_seen_markdown_help));
  const hasMarkedHelpSeen = useRef(false);
  useEffect(() => {
    if (hasMarkedHelpSeen.current) return;
    if (!user || user.preferences.has_seen_markdown_help) return;
    hasMarkedHelpSeen.current = true;
    updateMe({ preferences: { ...user.preferences, has_seen_markdown_help: true } }).then(updateUser);
  }, [user, updateUser]);

  // "@"-mention picker: typing "@query" opens a dropdown searching every relatable type
  // (searchKnowledge covers them all); picking one replaces "@query" with a markdown link and, when
  // `relateFrom` names this content's item, also links the two as Related Knowledge (createRelation
  // is get_or_create-backed, so a repeat mention is a no-op). RelatedContent.tsx still links
  // *without* an inline mention.
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
      const caret = getCaretCoordinates(textarea, mention.start);
      // Clamped so the fixed-width popup never runs past the textarea's right
      // edge for a mention typed near the end of a long line.
      const left = Math.min(caret.left, Math.max(0, textarea.clientWidth - MENTION_POPUP_WIDTH));
      setMentionCoords({ ...caret, left });
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

    if (relateFrom && !(relateFrom.type === result.type && relateFrom.id === result.id)) {
      setRelationError(null);
      createRelation({
        source_type: relateFrom.type,
        source_id: relateFrom.id,
        target_type: result.type,
        target_id: result.id,
      }).catch((err) => {
        setRelationError(
          t("relationError", { title: result.title, message: errorMessage(err) }),
        );
      });
    }
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

  // Inserts an "Uploading… N%" placeholder at insertPos immediately, then
  // swaps it for the real markdown reference once uploadFile() resolves (or
  // removes it and surfaces uploadError on failure) - the placeholder text
  // itself is the only thing identifying which upload owns which spot in
  // the content, so its "uploading:<id>" fake URL just needs to be unique
  // per call, not meaningful. The percent is live (from uploadFile's real
  // XHR progress events, not simulated), rewritten in place as it changes.
  async function uploadAndInsert(file: File, insertPos: number, isImage: boolean): Promise<number> {
    const uploadId = newUploadId();
    const placeholderFor = (percent: number) =>
      `${isImage ? "!" : ""}[${t(isImage ? "uploadingImage" : "uploadingFile", { filename: file.name, percent })}](uploading:${uploadId})`;
    let placeholderText = placeholderFor(0);

    const withPlaceholder =
      valueRef.current.slice(0, insertPos) + placeholderText + valueRef.current.slice(insertPos);
    valueRef.current = withPlaceholder;
    onChange(withPlaceholder);
    const cursor = insertPos + placeholderText.length;
    focusSelection(cursor, cursor);

    let lastPercent = 0;
    function handleProgress(fraction: number) {
      const percent = Math.round(fraction * 100);
      if (percent === lastPercent) return;
      lastPercent = percent;
      const nextPlaceholder = placeholderFor(percent);
      if (valueRef.current.includes(placeholderText)) {
        const next = valueRef.current.replace(placeholderText, nextPlaceholder);
        valueRef.current = next;
        onChange(next);
      }
      placeholderText = nextPlaceholder;
    }

    try {
      const uploaded = await uploadFile(file, { onProgress: handleProgress });
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
        t("uploadError", { filename: file.name, message: errorMessage(err) }),
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

  // Whole lines covered by the selection (or just the cursor's line) -
  // block syntax like "## " or "> " has to start at the line itself, not
  // wherever the cursor happens to sit inside it.
  function selectedLineRange(): { start: number; end: number } | null {
    const textarea = textareaRef.current;
    if (!textarea) return null;
    const { selectionStart, selectionEnd } = textarea;
    // A selection ending right after a newline (whole lines selected by
    // dragging) shouldn't drag the next, unselected line along.
    const effectiveEnd =
      selectionEnd > selectionStart && value[selectionEnd - 1] === "\n" ? selectionEnd - 1 : selectionEnd;
    const start = value.lastIndexOf("\n", selectionStart - 1) + 1;
    const newlineAfter = value.indexOf("\n", effectiveEnd);
    return { start, end: newlineAfter === -1 ? value.length : newlineAfter };
  }

  function replaceLines(transform: (lines: string[]) => string[], placeholderText: string) {
    const range = selectedLineRange();
    if (!range) return;
    const block = value.slice(range.start, range.end) || placeholderText;
    const replaced = transform(block.split("\n")).join("\n");
    onChange(value.slice(0, range.start) + replaced + value.slice(range.end));
    focusSelection(range.start, range.start + replaced.length);
  }

  function prefixLines(prefixFor: (index: number) => string, placeholderText: string) {
    replaceLines((lines) => lines.map((line, i) => prefixFor(i) + line), placeholderText);
  }

  function applyCallout(type: CalloutType) {
    setCalloutMenuOpen(false);
    replaceLines(
      (lines) => [`> [!${type.toUpperCase()}]`, ...lines.map((line) => `> ${line}`)],
      t("calloutPlaceholder"),
    );
  }

  // Single-line selections become inline math ($...$), multi-line ones a
  // display block ($$ on their own lines) - same split as applyCode.
  function applyEquation() {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const selected = value.slice(textarea.selectionStart, textarea.selectionEnd);
    if (selected.includes("\n")) {
      wrapSelection("$$\n", "\n$$", t("equationPlaceholder"));
    } else {
      wrapSelection("$", "$", t("equationPlaceholder"));
    }
  }

  function insertBlock(text: string) {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const { selectionStart } = textarea;
    const next = value.slice(0, selectionStart) + text + value.slice(selectionStart);
    onChange(next);
    focusSelection(selectionStart + text.length, selectionStart + text.length);
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
    insertBlock("\n| Column 1 | Column 2 |\n| --- | --- |\n| Value | Value |\n");
  }


  return (
    <div className="border border-outline-variant rounded-xl overflow-hidden bg-surface">
      {/* Mobile: Edit/Preview tabs stack above a wrapping toolbar (flex-col-reverse puts the
          later-in-DOM tabs on top) - on one unwrapped row the tabs got clipped off-screen by the
          container's overflow-hidden. sm+ keeps the single toolbar-left/tabs-right row. */}
      <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between border-b border-outline-variant bg-surface-container">
        <div className="flex flex-wrap items-center gap-1 px-2 py-1.5">
          <ToolButton
            icon="title"
            tooltip={t("headingTooltip")}
            onClick={() => prefixLines(() => "## ", t("headingPlaceholder"))}
            disabled={tab === "preview"}
          />
          <ToolButton
            icon="format_bold"
            tooltip={t("boldTooltip")}
            onClick={() => wrapSelection("**", "**", t("boldPlaceholder"))}
            disabled={tab === "preview"}
          />
          <ToolButton
            icon="format_italic"
            tooltip={t("italicTooltip")}
            onClick={() => wrapSelection("_", "_", t("italicPlaceholder"))}
            disabled={tab === "preview"}
          />
          <ToolButton
            icon="format_strikethrough"
            tooltip={t("strikethroughTooltip")}
            onClick={() => wrapSelection("~~", "~~", t("strikethroughPlaceholder"))}
            disabled={tab === "preview"}
          />
          <ToolbarSeparator />
          <ToolButton
            icon="format_list_bulleted"
            tooltip={t("bulletedListTooltip")}
            onClick={() => prefixLines(() => "- ", t("listItemPlaceholder"))}
            disabled={tab === "preview"}
          />
          <ToolButton
            icon="format_list_numbered"
            tooltip={t("numberedListTooltip")}
            onClick={() => prefixLines((i) => `${i + 1}. `, t("listItemPlaceholder"))}
            disabled={tab === "preview"}
          />
          <ToolButton
            icon="checklist"
            tooltip={t("taskListTooltip")}
            onClick={() => prefixLines(() => "- [ ] ", t("taskPlaceholder"))}
            disabled={tab === "preview"}
          />
          <ToolbarSeparator />
          <ToolButton
            icon="link"
            tooltip={t("linkTooltip")}
            onClick={() => wrapSelection("[", "](url)", t("linkTextPlaceholder"))}
            disabled={tab === "preview"}
          />
          <ToolButton
            icon="image"
            tooltip={t("imageTooltip")}
            onClick={() => wrapSelection("![", "](url)", t("imageAltPlaceholder"))}
            disabled={tab === "preview"}
          />
          <ToolButton
            icon="format_quote"
            tooltip={t("quoteTooltip")}
            onClick={() => prefixLines(() => "> ", t("quotePlaceholder"))}
            disabled={tab === "preview"}
          />
          <Popover.Root open={calloutMenuOpen} onOpenChange={setCalloutMenuOpen}>
            <Popover.Trigger asChild>
              <button
                type="button"
                disabled={tab === "preview"}
                aria-label={t("calloutTooltip")}
                title={t("calloutTooltip")}
                className={TOOLBAR_BUTTON_CLASS}
              >
                <Icon name="feedback" size={18} />
              </button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content
                align="start"
                sideOffset={6}
                onCloseAutoFocus={(e) => e.preventDefault()}
                className="min-w-40 bg-surface-container-lowest border border-outline-variant rounded-lg py-1 shadow-[0_2px_8px_0_rgba(0,0,0,0.15)] z-50"
              >
                {CALLOUT_TYPES.map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => applyCallout(type)}
                    className="flex w-full items-center px-3 py-2 text-start font-body-md text-body-md text-on-surface hover:bg-surface-variant transition-colors"
                  >
                    {markdownT(`callout.${type}`)}
                  </button>
                ))}
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
          <ToolbarSeparator />
          <ToolButton icon="code" tooltip={t("codeTooltip")} onClick={applyCode} disabled={tab === "preview"} />
          <ToolButton
            icon="functions"
            tooltip={t("equationTooltip")}
            onClick={applyEquation}
            disabled={tab === "preview"}
          />
          <ToolButton
            icon="table_chart"
            tooltip={t("tableTooltip")}
            onClick={applyTable}
            disabled={tab === "preview"}
          />
          <ToolButton
            icon="horizontal_rule"
            tooltip={t("horizontalRuleTooltip")}
            onClick={() => insertBlock("\n\n---\n\n")}
            disabled={tab === "preview"}
          />
          <ToolbarSeparator />
          <Popover.Root open={helpOpen} onOpenChange={setHelpOpen}>
            <Popover.Trigger asChild>
              <button
                type="button"
                aria-label={t("helpTooltip")}
                title={t("helpTooltip")}
                className={TOOLBAR_BUTTON_CLASS}
              >
                <Icon name="help" size={18} />
              </button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content
                align="start"
                sideOffset={8}
                className="max-w-xs bg-surface-container-lowest border border-outline-variant rounded-xl p-4 shadow-[0_4px_16px_0_rgba(0,0,0,0.12)] z-50 space-y-3"
              >
                <p className="font-label-caps text-label-caps text-on-surface-variant uppercase">{t("helpTitle")}</p>
                <ul className="space-y-2.5">
                  <li className="flex items-start gap-2">
                    <Icon name="alternate_email" size={16} className="text-primary shrink-0 mt-0.5" />
                    <span className="font-body-md text-body-md text-on-surface">{t("helpMention")}</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Icon name="upload" size={16} className="text-primary shrink-0 mt-0.5" />
                    <span className="font-body-md text-body-md text-on-surface">{t("helpUpload")}</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Icon name="diagram" size={16} className="text-primary shrink-0 mt-0.5" />
                    <span className="font-body-md text-body-md text-on-surface">{t("helpMermaid")}</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Icon name="functions" size={16} className="text-primary shrink-0 mt-0.5" />
                    <span className="font-body-md text-body-md text-on-surface">{t("helpMath")}</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Icon name="feedback" size={16} className="text-primary shrink-0 mt-0.5" />
                    <span className="font-body-md text-body-md text-on-surface">{t("helpCallout")}</span>
                  </li>
                </ul>
                {/* New tab - navigating away here would lose whatever is being written. */}
                <Link
                  href="/help?tab=writing"
                  target="_blank"
                  rel="noopener"
                  className="inline-flex items-center gap-1 font-body-md text-body-md text-primary hover:underline"
                >
                  {t("helpFullGuide")}
                  <Icon name="open_in_new" size={14} />
                </Link>
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
        </div>
        <div className="flex items-center gap-1 px-2 py-1.5 sm:py-0 border-b border-outline-variant sm:border-b-0 shrink-0">
          <button
            type="button"
            onClick={() => setTab("edit")}
            className={`flex-1 sm:flex-none px-3 py-1 rounded-lg font-label-caps text-label-caps uppercase transition-colors ${
              tab === "edit" ? "bg-surface-container-lowest text-primary" : "text-on-surface-variant"
            }`}
          >
            {t("editTab")}
          </button>
          <button
            type="button"
            onClick={() => setTab("preview")}
            className={`flex-1 sm:flex-none px-3 py-1 rounded-lg font-label-caps text-label-caps uppercase transition-colors ${
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
      {relationError && (
        <p className="px-4 py-2 font-body-md text-body-md text-error border-b border-outline-variant" role="alert">
          {relationError}
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
              style={{ top: mentionCoords.top + mentionCoords.height, left: mentionCoords.left, width: MENTION_POPUP_WIDTH }}
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
