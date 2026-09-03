"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { Icon } from "./Icon";
import { createBookmark, deleteBookmark } from "@/lib/api/bookmarks";
import type { RelatableType } from "@/lib/api/types";

interface BookmarkButtonProps {
  type: RelatableType;
  objectId: string;
  /** The item's own bookmark_id from its Detail payload (see BookmarkMixin) - null if not bookmarked. */
  bookmarkId: string | null;
}

const LABEL_DISPLAY_MS = 1500;

// Icon-only by default (like IconButton) - a click toggles the bookmark and
// briefly expands the button to show a text label confirming the new state
// (same "temporary text feedback" idea as ShareButton's "Copied!" swap, but
// collapsing back to icon-only after a beat instead of staying expanded).
// No extra lookup needed since `bookmarkId` comes straight off the Detail
// payload (the id to delete on unbookmark). Callers must pass
// `key={objectId}` (see the detail pages) so navigating to a different item
// remounts this with fresh initial state, rather than syncing via an effect.
export function BookmarkButton({ type, objectId, bookmarkId: initialBookmarkId }: BookmarkButtonProps) {
  const t = useTranslations("common");
  const [bookmarkId, setBookmarkId] = useState(initialBookmarkId);
  const [isWorking, setIsWorking] = useState(false);
  const [showLabel, setShowLabel] = useState(false);
  const collapseTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (collapseTimeout.current) clearTimeout(collapseTimeout.current);
    };
  }, []);

  async function handleToggle() {
    setIsWorking(true);
    try {
      if (bookmarkId) {
        await deleteBookmark(bookmarkId);
        setBookmarkId(null);
      } else {
        const bookmark = await createBookmark(type, objectId);
        setBookmarkId(bookmark.id);
      }
      setShowLabel(true);
      if (collapseTimeout.current) clearTimeout(collapseTimeout.current);
      collapseTimeout.current = setTimeout(() => setShowLabel(false), LABEL_DISPLAY_MS);
    } finally {
      setIsWorking(false);
    }
  }

  const label = bookmarkId ? t("bookmarked") : t("bookmark");

  return (
    <button
      type="button"
      onClick={handleToggle}
      disabled={isWorking}
      aria-label={label}
      title={label}
      // Padding is constant (no gap, no variable padding) so the collapsed
      // state is a perfectly symmetric square around the icon - all the
      // icon-to-label spacing lives on the label's own margin below, which
      // animates open together with its width/opacity instead of leaving a
      // fixed gap reserved when the label is collapsed to zero width.
      className="inline-flex items-center p-2 rounded-lg border border-outline-variant bg-surface text-on-surface hover:bg-surface-variant transition-colors duration-150 disabled:opacity-60 disabled:cursor-not-allowed"
    >
      <Icon name="bookmark" size={16} filled={!!bookmarkId} className="shrink-0" />
      <span
        className={`font-body-md text-body-md whitespace-nowrap overflow-hidden transition-[max-width,opacity,margin-left] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] ${
          showLabel ? "max-w-[160px] opacity-100 ms-2" : "max-w-0 opacity-0 ms-0"
        }`}
      >
        {label}
      </span>
    </button>
  );
}
