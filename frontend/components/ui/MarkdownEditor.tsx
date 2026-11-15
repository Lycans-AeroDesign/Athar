"use client";

import * as Popover from "@radix-ui/react-popover";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { Icon } from "./Icon";
import { ImageCropModal } from "./ImageCropModal";
import { Markdown } from "./Markdown";
import { Link } from "@/i18n/navigation";
import { errorMessage } from "@/lib/errors";
import { CALLOUT_TYPES, type CalloutType } from "@/lib/markdownCallouts";
import { updateMe } from "@/lib/api/accounts";
import { apiFetch } from "@/lib/api/client";
import { createRelation, quickSearch } from "@/lib/api/knowledge";
import { uploadFile } from "@/lib/api/files";
import type { RelatableType, SearchResult } from "@/lib/api/types";
import { useAuth } from "@/lib/auth/AuthProvider";
import { RELATABLE_ICON, RELATABLE_ROUTE_PREFIX } from "@/lib/knowledgeTypes";
import {
  canDisplayAsMention,
  mentionLink,
  mentionRanges,
  toDisplay,
  toStorage,
  type MentionMap,
} from "@/lib/mentions";

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

interface MarkdownImageMatch {
  alt: string;
  url: string;
  start: number;
  end: number;
  fullMatch: string;
}

function findImages(text: string): MarkdownImageMatch[] {
  const regex = /!\[([^\]]*)\]\((\S+?)(?:\s+"[^"]*")?\)/g;
  const matches: MarkdownImageMatch[] = [];
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    matches.push({
      alt: m[1],
      url: m[2],
      start: m.index,
      end: m.index + m[0].length,
      fullMatch: m[0],
    });
  }
  return matches;
}

function findImageAtCursor(text: string, cursor: number): MarkdownImageMatch | null {
  const images = findImages(text);
  return images.find((img) => cursor >= img.start && cursor <= img.end) ?? null;
}

// The mention highlight layer's content - plain text with a tinted <mark>
// per @-mention (see MarkdownEditor's backdrop). A trailing zero-width space
// keeps a final empty line from collapsing, matching how the textarea renders it.
function buildHighlightSegments(value: string, mentions: MentionMap): ReactNode[] {
  const segments: ReactNode[] = [];
  let cursor = 0;
  for (const range of mentionRanges(value, mentions)) {
    if (range.start > cursor) segments.push(value.slice(cursor, range.start));
    segments.push(
      <mark
        key={range.start}
        className="rounded-[3px] bg-primary/15 text-transparent shadow-[0_0_0_1.5px_color-mix(in_srgb,var(--color-primary)_35%,transparent)]"
      >
        {value.slice(range.start, range.end)}
      </mark>,
    );
    cursor = range.end;
  }
  segments.push(value.slice(cursor), "​");
  return segments;
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
export function MarkdownEditor({ value: storedValue, onChange: onStoredChange, placeholder, relateFrom }: MarkdownEditorProps) {
  // Everything below edits the *display* text, where each @-mention link
  // `[Motor](/components/<uuid>)` reads as `@Motor` (lib/mentions.ts) - the
  // textarea, its selection offsets and every toolbar/upload helper all work
  // in that one coordinate space, and onChange maps edits back to the stored
  // markdown. mentionsRef (not the render's `mentions`) so an upload resolving
  // after a later edit converts with the mentions current at that point.
  const { display: value, mentions } = toDisplay(storedValue);
  const mentionsRef = useRef(mentions);
  useEffect(() => {
    mentionsRef.current = mentions;
  }, [mentions]);
  function onChange(nextDisplay: string, extraMentions?: MentionMap) {
    const map = extraMentions ? new Map([...mentionsRef.current, ...extraMentions]) : mentionsRef.current;
    onStoredChange(toStorage(nextDisplay, map));
  }

  // The mention highlight layer behind the textarea (see the edit tab's JSX),
  // kept at the textarea's inner size and scroll offset.
  const backdropRef = useRef<HTMLDivElement>(null);
  const highlightSegments = buildHighlightSegments(value, mentions);

  function syncBackdrop() {
    const textarea = textareaRef.current;
    const backdrop = backdropRef.current;
    if (!textarea || !backdrop) return;
    // clientWidth/Height exclude the scrollbar, so the copy wraps at exactly
    // the textarea's text width even once it starts scrolling.
    backdrop.style.width = `${textarea.clientWidth}px`;
    backdrop.style.height = `${textarea.clientHeight}px`;
    backdrop.scrollTop = textarea.scrollTop;
    backdrop.scrollLeft = textarea.scrollLeft;
  }

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    syncBackdrop();
    const observer = new ResizeObserver(syncBackdrop);
    observer.observe(textarea);
    return () => observer.disconnect();
  });

  const t = useTranslations("knowledge.editor");
  const commonT = useTranslations("common");
  const markdownT = useTranslations("markdown");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Where the caret was last, so a caret that lands inside a token can be
  // pushed out the way it was travelling (ArrowLeft from after "@Motor" jumps
  // to before it, rather than snapping straight back to where it came from).
  const lastCaretRef = useRef<number | null>(null);
  const [tab, setTab] = useState<"edit" | "preview">("edit");
  // Selection to restore when coming back from Preview, so the caret lands
  // where you left off (the textarea unmounts while Preview is shown).
  // null until you've been in the textarea - then Edit puts the caret at the end.
  const savedSelectionRef = useRef<{ start: number; end: number } | null>(null);
  // Set only by clicking the Edit tab, so the textarea isn't focused on the
  // page's first render - just when switching back from Preview.
  const focusOnEditRef = useRef(false);
  // Whether the textarea has had focus yet - a never-touched textarea reports
  // selectionStart 0, which shouldn't count as "where you left off".
  const hasFocusedRef = useRef(false);

  function switchToPreview() {
    const textarea = textareaRef.current;
    // Not document.activeElement: pressing the Preview button has already
    // blurred the textarea by now, but it keeps its selection.
    if (tab === "edit" && textarea && hasFocusedRef.current) {
      savedSelectionRef.current = { start: textarea.selectionStart, end: textarea.selectionEnd };
    }
    setTab("preview");
  }

  function switchToEdit() {
    if (tab === "edit") return;
    focusOnEditRef.current = true;
    setTab("edit");
  }

  useEffect(() => {
    if (tab !== "edit" || !focusOnEditRef.current) return;
    focusOnEditRef.current = false;
    const textarea = textareaRef.current;
    if (!textarea) return;
    const end = textarea.value.length;
    const saved = savedSelectionRef.current;
    const start = Math.min(saved?.start ?? end, end);
    const finish = Math.min(saved?.end ?? end, end);
    textarea.focus();
    textarea.setSelectionRange(start, finish);
    lastCaretRef.current = start;
  }, [tab]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [relationError, setRelationError] = useState<string | null>(null);
  const [calloutMenuOpen, setCalloutMenuOpen] = useState(false);

  // Crop flow: images heading into an upload from a paste/drop or an existing-image
  // edit are routed through ImageCropModal first - openCrop() parks it on a pending
  // promise (resolver kept in a ref so openCrop stays async/await-friendly), and
  // finishCrop() resolves it with the cropped File, "skip" (insert the original untouched
  // or cancel edit) or null (discard that file). Both create and edit pages render this
  // editor, so one wiring covers both.
  const cropResolverRef = useRef<((result: File | "skip" | null) => void) | null>(null);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [cropIsExisting, setCropIsExisting] = useState(false);
  const [isFetchingCrop, setIsFetchingCrop] = useState(false);
  const [cropMenuOpen, setCropMenuOpen] = useState(false);

  function openCrop(file: File, isExisting = false): Promise<File | "skip" | null> {
    return new Promise((resolve) => {
      cropResolverRef.current = resolve;
      setCropIsExisting(isExisting);
      setCropFile(file);
    });
  }

  function finishCrop(result: File | "skip" | null) {
    setCropFile(null);
    setCropIsExisting(false);
    const resolve = cropResolverRef.current;
    cropResolverRef.current = null;
    resolve?.(result);
  }

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
  // (quickSearch covers them all); picking one replaces "@query" with a markdown link and, when
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
  const [mentionCoords, setMentionCoords] = useState<{ top: number; left: number; height: number; width: number } | null>(
    null,
  );

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
      // On a phone-width editor the popup shrinks to fit rather than overflowing it.
      const width = Math.min(MENTION_POPUP_WIDTH, textarea.clientWidth);
      const left = Math.min(caret.left, Math.max(0, textarea.clientWidth - width));
      setMentionCoords({ ...caret, left, width });
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
      quickSearch(query)
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
    // The caret sitting right after an already-picked "@Motor" isn't a new mention.
    const isExisting = detected !== null && mentions.has(detected.query);
    setMention(detected && (detected.start === dismissedStart || isExisting) ? null : detected);
  }

  function selectMention(result: SearchResult) {
    if (!mention) return;
    const end = mention.start + 1 + mention.query.length;
    const href = `${RELATABLE_ROUTE_PREFIX[result.type]}/${result.id}`;
    const before = value.slice(0, mention.start);
    const after = value.slice(end);
    // Shown as "@Title" when that maps back losslessly (lib/mentions.ts's
    // toDisplay agrees); otherwise - a same-titled but different item already
    // in the text, say - the raw link is inserted so nothing is ambiguous.
    // A trailing space (unless one already follows) so typing carries on as
    // normal text after the mention instead of running into it.
    const spacer = /^\s/.test(after) ? "" : " ";
    let inserted = `@${result.title}${spacer}`;
    const extra: MentionMap = new Map([[result.title, href]]);
    const candidate = before + inserted + after;
    const fitsAsMention =
      canDisplayAsMention(result.title) &&
      toDisplay(toStorage(candidate, new Map([...mentionsRef.current, ...extra]))).display === candidate;
    if (!fitsAsMention) inserted = mentionLink(result.title, href) + spacer;
    onChange(before + inserted + after, fitsAsMention ? extra : undefined);
    const cursor = mention.start + inserted.length;
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

  // Picked @-mentions behave as single tokens in the textarea: Backspace/
  // Delete next to one removes all of it, a deletion that cuts into one
  // widens to cover it, and the caret never rests inside one (see
  // snapSelection). Ranges are read off the textarea's live value rather than
  // `value`, which only catches up once the parent re-renders.
  function tokenRanges(text: string) {
    return mentionRanges(text, mentionsRef.current);
  }

  function handleTokenKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== "Backspace" && e.key !== "Delete") return;
    const textarea = e.currentTarget;
    const { selectionStart: start, selectionEnd: end } = textarea;
    const ranges = tokenRanges(textarea.value);
    let from = start;
    let to = end;
    if (start === end) {
      const hit = ranges.find((r) =>
        e.key === "Backspace" ? start > r.start && start <= r.end : start >= r.start && start < r.end,
      );
      if (!hit) return;
      from = hit.start;
      to = hit.end;
    } else {
      for (const r of ranges) {
        if (r.start < to && r.end > from) {
          from = Math.min(from, r.start);
          to = Math.max(to, r.end);
        }
      }
      if (from === start && to === end) return; // nothing partially covered - native delete is right
    }
    e.preventDefault();
    const next = textarea.value.slice(0, from) + textarea.value.slice(to);
    onChange(next);
    lastCaretRef.current = from;
    focusSelection(from, from);
  }


  function snapSelection(textarea: HTMLTextAreaElement, expandRange: boolean) {
    const { selectionStart: start, selectionEnd: end, selectionDirection } = textarea;
    const ranges = tokenRanges(textarea.value);
    if (start === end) {
      const inside = ranges.find((r) => start > r.start && start < r.end);
      const previous = lastCaretRef.current;
      let caret = start;
      if (inside) {
        if (previous !== null && previous <= inside.start) caret = inside.end;
        else if (previous !== null && previous >= inside.end) caret = inside.start;
        else caret = start - inside.start < inside.end - start ? inside.start : inside.end;
        textarea.setSelectionRange(caret, caret);
      }
      lastCaretRef.current = caret;
      return;
    }
    // Only once a drag/shift-selection settles - adjusting mid-drag fights the mouse.
    if (!expandRange) return;
    let from = start;
    let to = end;
    for (const r of ranges) {
      if (from > r.start && from < r.end) from = r.start;
      if (to > r.start && to < r.end) to = r.end;
    }
    if (from !== start || to !== end) textarea.setSelectionRange(from, to, selectionDirection);
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
  // each separated by a blank line once more than one is involved. Images
  // pause for a crop decision first; discarding one drops it (and, for later
  // files, the blank line it would have claimed) from the queue entirely.
  async function uploadFilesAtCursor(files: File[], startPos: number, imagesOnly: boolean) {
    setUploadError(null);
    let pos = startPos;
    let isFirst = true;
    for (const file of files) {
      const isImage = file.type.startsWith("image/");
      if (imagesOnly && !isImage) continue;
      let toUpload = file;
      if (isImage) {
        const decision = await openCrop(file);
        if (decision === null) continue;
        if (decision !== "skip") toUpload = decision;
      }
      if (!isFirst) {
        const withSeparator = valueRef.current.slice(0, pos) + "\n\n" + valueRef.current.slice(pos);
        valueRef.current = withSeparator;
        onChange(withSeparator);
        pos += 2;
      }
      isFirst = false;
      pos = await uploadAndInsert(toUpload, pos, isImage);
    }
  }

  async function uploadAndReplace(
    croppedFile: File,
    target: MarkdownImageMatch | null,
    originalSrc: string,
    originalAlt?: string,
  ) {
    const uploadId = newUploadId();
    const altText = originalAlt ?? target?.alt ?? croppedFile.name;
    const placeholderFor = (percent: number) =>
      `![${t("uploadingImage", { filename: croppedFile.name, percent })}](uploading:${uploadId})`;
    let placeholderText = placeholderFor(0);

    const originalMarkdown = target?.fullMatch ?? `![${altText}](${originalSrc})`;
    if (valueRef.current.includes(originalMarkdown)) {
      const withPlaceholder = valueRef.current.replace(originalMarkdown, placeholderText);
      valueRef.current = withPlaceholder;
      onChange(withPlaceholder);
    } else {
      const withPlaceholder = `${valueRef.current}\n\n${placeholderText}`;
      valueRef.current = withPlaceholder;
      onChange(withPlaceholder);
    }

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
      const uploaded = await uploadFile(croppedFile, { onProgress: handleProgress });
      const finalText = `![${altText}](${uploaded.download_url})`;
      const current = valueRef.current;
      const next = current.includes(placeholderText)
        ? current.replace(placeholderText, finalText)
        : `${current}\n${finalText}`;
      valueRef.current = next;
      onChange(next);
    } catch (err) {
      const current = valueRef.current;
      const next = current.includes(placeholderText)
        ? current.replace(placeholderText, originalMarkdown)
        : current;
      valueRef.current = next;
      onChange(next);
      setUploadError(
        t("uploadError", { filename: croppedFile.name, message: errorMessage(err) }),
      );
    }
  }

  async function cropExistingImage(src: string, alt?: string) {
    if (cropResolverRef.current || isFetchingCrop) {
      setUploadError(t("finishCropFirst"));
      return;
    }
    const images = findImages(valueRef.current);
    const target =
      images.find((img) => img.url === src && (!alt || img.alt === alt)) ??
      images.find((img) => img.url === src) ??
      null;

    setIsFetchingCrop(true);
    setUploadError(null);
    try {
      let blob: Blob;
      if (src.startsWith("/api/")) {
        const res = await apiFetch(src);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        blob = await res.blob();
      } else {
        const res = await fetch(src);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        blob = await res.blob();
      }
      const mime = blob.type || "image/png";
      let filename = (alt || target?.alt || "").trim();
      if (!filename || !/\.[a-z0-9]{2,5}$/i.test(filename)) {
        const ext = mime === "image/jpeg" ? ".jpg" : mime === "image/webp" ? ".webp" : ".png";
        filename = `${filename || "image"}${ext}`;
      }
      const file = new File([blob], filename, { type: mime });
      setIsFetchingCrop(false);

      const decision = await openCrop(file, true);
      if (!decision || decision === "skip") return;

      await uploadAndReplace(decision, target, src, alt);
    } catch (err) {
      setIsFetchingCrop(false);
      setUploadError(t("cropLoadError", { message: errorMessage(err) }));
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith("image/"));
    if (files.length === 0) return; // plain text paste - let the browser handle it normally.
    if (cropResolverRef.current) {
      e.preventDefault();
      setUploadError(t("finishCropFirst"));
      return;
    }
    e.preventDefault();
    void uploadFilesAtCursor(files, e.currentTarget.selectionStart, true);
  }

  function handleDragOver(e: React.DragEvent<HTMLTextAreaElement>) {
    if (e.dataTransfer.types.includes("Files")) e.preventDefault();
  }

  function handleDrop(e: React.DragEvent<HTMLTextAreaElement>) {
    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return; // e.g. dragging selected text within the page - let the browser handle it.
    if (cropResolverRef.current) {
      e.preventDefault();
      setUploadError(t("finishCropFirst"));
      return;
    }
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

  const imagesInDoc = findImages(value);

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
          <Popover.Root open={cropMenuOpen} onOpenChange={setCropMenuOpen}>
            <Popover.Trigger asChild>
              <button
                type="button"
                disabled={imagesInDoc.length === 0 || isFetchingCrop}
                aria-label={t("cropImageTooltip")}
                title={imagesInDoc.length === 0 ? t("noImagesToCrop") : t("cropImageTooltip")}
                onClick={(e) => {
                  const atCursor =
                    tab === "edit" && textareaRef.current
                      ? findImageAtCursor(value, textareaRef.current.selectionStart)
                      : null;
                  if (atCursor) {
                    e.preventDefault();
                    void cropExistingImage(atCursor.url, atCursor.alt);
                    return;
                  }
                  if (imagesInDoc.length === 1) {
                    e.preventDefault();
                    void cropExistingImage(imagesInDoc[0].url, imagesInDoc[0].alt);
                    return;
                  }
                }}
                className={TOOLBAR_BUTTON_CLASS}
              >
                <Icon name="crop" size={18} />
              </button>
            </Popover.Trigger>
            {imagesInDoc.length > 1 && (
              <Popover.Portal>
                <Popover.Content
                  align="start"
                  sideOffset={6}
                  className="z-50 min-w-[200px] max-w-sm max-h-64 overflow-y-auto rounded-lg border border-outline-variant bg-surface-container-lowest p-1 shadow-lg focus:outline-none"
                >
                  <p className="px-3 py-1.5 font-label-sm text-label-sm uppercase text-on-surface-variant font-semibold">
                    {t("selectImageToCrop")}
                  </p>
                  <ul className="py-1">
                    {imagesInDoc.map((img, i) => (
                      <li key={`${img.url}-${i}`}>
                        <button
                          type="button"
                          onClick={() => {
                            setCropMenuOpen(false);
                            void cropExistingImage(img.url, img.alt);
                          }}
                          className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-start font-body-md text-body-md text-on-surface hover:bg-surface-variant transition-colors truncate"
                        >
                          <Icon name="image" size={16} className="text-on-surface-variant shrink-0" />
                          <span className="truncate">
                            {img.alt || img.url.split("/").filter(Boolean).pop() || `Image ${i + 1}`}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </Popover.Content>
              </Popover.Portal>
            )}
          </Popover.Root>
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
            onClick={switchToEdit}
            className={`flex-1 sm:flex-none px-3 py-1 rounded-lg font-label-caps text-label-caps uppercase transition-colors ${
              tab === "edit" ? "bg-surface-container-lowest text-primary" : "text-on-surface-variant"
            }`}
          >
            {t("editTab")}
          </button>
          <button
            type="button"
            onClick={switchToPreview}
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
      {isFetchingCrop && (
        <p className="px-4 py-2 bg-surface-container-high text-on-surface-variant font-body-md text-body-md border-b border-outline-variant flex items-center gap-2">
          <Icon name="pending" size={16} className="animate-spin" />
          <span>{t("loadingImage")}</span>
        </p>
      )}
      {relationError && (
        <p className="px-4 py-2 font-body-md text-body-md text-error border-b border-outline-variant" role="alert">
          {relationError}
        </p>
      )}
      {tab === "edit" ? (
        <div className="relative">
          {/* Highlight layer for @-mentions: a textarea can't style part of its
              text, so an identically laid-out copy sits behind it (same font,
              padding, wrapping, width and scroll) with transparent text and a
              tint behind each mention. Only background is painted - the real
              text stays the textarea's, so a slight layout mismatch could only
              ever misplace a tint, never the text or caret. */}
          <div
            ref={backdropRef}
            aria-hidden="true"
            className="absolute top-0 start-0 overflow-hidden pointer-events-none"
          >
            <div className="p-4 font-mono-sm text-mono-sm text-transparent whitespace-pre-wrap wrap-break-word">
              {highlightSegments}
            </div>
          </div>
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => {
              onChange(e.target.value);
              updateMentionFromCursor(e.target.value, e.target.selectionStart);
            }}
            onSelect={(e) => {
              snapSelection(e.currentTarget, false);
              updateMentionFromCursor(e.currentTarget.value, e.currentTarget.selectionStart);
            }}
            onPointerUp={(e) => snapSelection(e.currentTarget, true)}
            onKeyUp={(e) => {
              if (e.shiftKey) snapSelection(e.currentTarget, true);
            }}
            onKeyDown={(e) => {
              handleMentionKeyDown(e);
              if (!e.defaultPrevented) handleTokenKeyDown(e);
            }}
            onScroll={syncBackdrop}
            onFocus={() => {
              hasFocusedRef.current = true;
            }}
            onPaste={handlePaste}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            placeholder={placeholder}
            className="relative block w-full min-h-[400px] p-4 bg-transparent font-mono-sm text-mono-sm text-on-surface resize-y outline-none"
          />
          {mention && mentionCoords && (
            <div
              className="absolute z-10 max-h-64 overflow-y-auto bg-surface-container-lowest border border-outline-variant rounded-lg shadow-[0_2px_8px_0_rgba(0,0,0,0.15)]"
              style={{ top: mentionCoords.top + mentionCoords.height, left: mentionCoords.left, width: mentionCoords.width }}
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
            <Markdown content={storedValue} onCropImage={cropExistingImage} linksInNewTab />
          ) : (
            <p className="font-body-md text-body-md text-on-surface-variant">{placeholder}</p>
          )}
        </div>
      )}
      <ImageCropModal file={cropFile} isExisting={cropIsExisting} onDone={finishCrop} />
    </div>
  );
}
