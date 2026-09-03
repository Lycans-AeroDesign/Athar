"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Icon } from "@/components/ui/Icon";
import { Pagination } from "@/components/ui/Pagination";
import { Link } from "@/i18n/navigation";
import { deleteBookmark, getBookmarks } from "@/lib/api/bookmarks";
import type { BookmarkEntry, RelatableType } from "@/lib/api/types";
import { RELATABLE_ICON, RELATABLE_ROUTE_PREFIX } from "@/lib/knowledgeTypes";

type BookmarkTab = RelatableType | "all";

const TABS: BookmarkTab[] = ["all", "article", "question", "project", "component", "failure", "sop", "test", "document"];

// Trimmed ContributionsPanel.tsx (tab row + Pagination, no stats/leaderboard/
// activity feed) - BookmarkEntry is deliberately thin (id/type/object_id/
// title only), so every tab renders through the same generic row rather than
// per-type cards.
export function BookmarksPanel() {
  const t = useTranslations("bookmarksPage");
  const [tab, setTab] = useState<BookmarkTab>("all");
  const [page, setPage] = useState(1);

  const [result, setResult] = useState<{ key: string; entries: BookmarkEntry[]; hasNext: boolean; count: number } | null>(
    null,
  );
  const resultKey = `${tab}:${page}`;
  const entries = result?.key === resultKey ? result.entries : null;

  useEffect(() => {
    getBookmarks(tab === "all" ? undefined : tab, page).then((data) =>
      setResult({ key: resultKey, entries: data.results, hasNext: data.next !== null, count: data.count }),
    );
  }, [tab, page, resultKey]);

  function selectTab(next: BookmarkTab) {
    setTab(next);
    setPage(1);
  }

  async function handleRemove(id: string) {
    await deleteBookmark(id);
    setResult((prev) => (prev ? { ...prev, entries: prev.entries.filter((entry) => entry.id !== id) } : prev));
  }

  return (
    <div className="space-y-6">
      <div className="border-b border-outline-variant">
        <div className="flex flex-wrap items-center gap-2">
          {TABS.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => selectTab(value)}
              className={`flex items-center gap-1.5 px-4 py-2 font-label-caps text-label-caps uppercase border-b-2 transition-colors -mb-px ${
                tab === value
                  ? "text-primary border-primary"
                  : "text-on-surface-variant border-transparent hover:text-on-surface"
              }`}
            >
              {value !== "all" && <Icon name={RELATABLE_ICON[value]} size={16} />}
              {t(`tab_${value}`)}
            </button>
          ))}
        </div>
      </div>

      {entries === null ? (
        <p className="font-body-md text-body-md text-on-surface-variant">{t("loading")}</p>
      ) : entries.length === 0 ? (
        <p className="font-body-md text-body-md text-on-surface-variant">{t("emptyState")}</p>
      ) : (
        <div className="space-y-2">
          {entries.map((entry) => (
            <div
              key={entry.id}
              className="flex items-center gap-3 bg-surface-container-low border border-outline-variant rounded-xl p-4"
            >
              <Icon name={RELATABLE_ICON[entry.type]} size={20} className="text-on-surface-variant shrink-0" />
              <Link
                href={`${RELATABLE_ROUTE_PREFIX[entry.type]}/${entry.object_id}`}
                className="flex-1 min-w-0 font-body-md text-body-md text-on-surface hover:text-primary hover:underline truncate"
              >
                {entry.title ?? t("untitled")}
              </Link>
              <button
                type="button"
                onClick={() => handleRemove(entry.id)}
                aria-label={t("removeBookmark")}
                className="text-on-surface-variant hover:text-error transition-colors shrink-0"
              >
                <Icon name="close" size={16} />
              </button>
            </div>
          ))}
        </div>
      )}

      {entries && entries.length > 0 && (
        <Pagination
          page={page}
          hasNext={result?.hasNext ?? false}
          hasPrevious={page > 1}
          onPageChange={setPage}
          totalCount={result?.count}
        />
      )}
    </div>
  );
}
