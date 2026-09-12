import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { Icon } from "@/components/ui/Icon";
import { Pagination } from "@/components/ui/Pagination";
import { Link } from "@/i18n/navigation";
import type { RelatableType, SearchResult } from "@/lib/api/types";
import { RELATABLE_ICON, RELATABLE_ROUTE_PREFIX } from "@/lib/knowledgeTypes";

export type SearchScope = "all" | RelatableType;

// Every relatable type the backend's SearchView actually returns counts/
// results for (see backend/knowledge/views.py) - shared by the text-search
// page and the "browse by tag" page below, so the filter list and result
// badges always cover the same types the API's `counts` returns.
export const SEARCH_CONTENT_TYPES: RelatableType[] = [
  "article",
  "question",
  "project",
  "component",
  "failure",
  "sop",
  "test",
  "document",
];

export const SEARCH_FILTER_LABEL_KEYS: Record<RelatableType, string> = {
  article: "filterArticles",
  question: "filterQuestions",
  project: "filterProjects",
  component: "filterComponents",
  failure: "filterFailures",
  sop: "filterSops",
  test: "filterTests",
  document: "filterDocuments",
};

const BADGE_LABEL_KEYS: Record<RelatableType, string> = {
  article: "badgeArticle",
  question: "badgeQuestion",
  project: "badgeProject",
  component: "badgeComponent",
  failure: "badgeFailure",
  sop: "badgeSop",
  test: "badgeTest",
  document: "badgeDocument",
};

export const SEARCH_SCOPE_OPTIONS: { value: SearchScope; labelKey: string }[] = [
  { value: "all", labelKey: "filterAll" },
  ...SEARCH_CONTENT_TYPES.map((value) => ({ value, labelKey: SEARCH_FILTER_LABEL_KEYS[value] })),
];

export type SearchCounts = Record<RelatableType, number>;

export const EMPTY_SEARCH_COUNTS: SearchCounts = {
  article: 0,
  question: 0,
  project: 0,
  component: 0,
  failure: 0,
  sop: 0,
  test: 0,
  document: 0,
};

// Wraps <mark> around every case-insensitive occurrence of `query` inside
// `text` - purely a visual aid for why a result matched, independent of the
// actual relevance ranking/ordering. Unused (returns `text` as-is) when
// `query` is empty - the tag-browse page has no text query to highlight.
function highlight(text: string, query: string): ReactNode {
  const trimmed = query.trim();
  if (!trimmed) return text;
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = text.split(new RegExp(`(${escaped})`, "gi"));
  return parts.map((part, i) =>
    part.toLowerCase() === trimmed.toLowerCase() ? (
      <mark key={i} className="bg-primary/20 text-inherit rounded-sm">
        {part}
      </mark>
    ) : (
      part
    ),
  );
}

interface SearchResultsPanelProps {
  results: SearchResult[] | null;
  counts: SearchCounts;
  scope: SearchScope;
  onScopeChange: (scope: SearchScope) => void;
  /** Text to <mark> inside result titles/excerpts - omit on the tag-browse page, which has no text query. */
  query?: string;
  /** Shown once `results` is non-null but empty. */
  emptyMessage: string;
  /** Shown while `results` is still null. */
  loadingMessage: string;
  page: number;
  hasMore: boolean;
  onPageChange: (page: number) => void;
  /** Extra content between the filter sidebar's header and its type-checkbox list - e.g. a sort-order control on the search page. */
  headerExtra?: ReactNode;
}

/** Shared filter-sidebar + result-list + pagination UI for both the text-
 * search page and the "browse everything with this tag" page - both hit the
 * same backend endpoint/response shape (see backend/knowledge/views.py's
 * SearchView), just keyed by ?q= vs ?tag=. */
export function SearchResultsPanel({
  results,
  counts,
  scope,
  onScopeChange,
  query = "",
  emptyMessage,
  loadingMessage,
  page,
  hasMore,
  onPageChange,
  headerExtra,
}: SearchResultsPanelProps) {
  const t = useTranslations("knowledge.search");
  const totalCount = SEARCH_CONTENT_TYPES.reduce((sum, type) => sum + counts[type], 0);
  const scopedCount = scope === "all" ? totalCount : counts[scope];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      <aside className="lg:col-span-3 space-y-4">
        <h2 className="font-label-caps text-label-caps uppercase text-on-surface-variant px-3">{t("filtersTitle")}</h2>
        <div className="space-y-2">
          <h3 className="font-body-md text-body-md font-bold text-on-surface px-3">{t("contentTypeTitle")}</h3>
          <ul className="space-y-1">
            {SEARCH_SCOPE_OPTIONS.map((option) => {
              const count = option.value === "all" ? totalCount : counts[option.value];
              const isSelected = scope === option.value;
              return (
                <li key={option.value}>
                  <label
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors ${
                      isSelected ? "bg-primary/10 text-primary" : "text-on-surface-variant hover:bg-surface-variant"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => onScopeChange(option.value)}
                      className="rounded border-outline-variant text-primary focus:ring-primary w-4 h-4 shrink-0"
                    />
                    <span className="font-body-md text-body-md flex-1">{t(option.labelKey)}</span>
                    <span className="font-mono-sm text-mono-sm text-on-surface-variant bg-surface-container px-2 py-0.5 rounded-full">
                      {count}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      </aside>

      <div className="lg:col-span-9 space-y-4">
        {headerExtra}

        {results === null ? (
          <p className="font-body-md text-body-md text-on-surface-variant">{loadingMessage}</p>
        ) : results.length === 0 ? (
          <p className="font-body-md text-body-md text-on-surface-variant">{emptyMessage}</p>
        ) : (
          <ul className="space-y-3">
            {results.map((result) => (
              <li key={`${result.type}-${result.id}`}>
                <Link
                  href={`${RELATABLE_ROUTE_PREFIX[result.type]}/${result.id}`}
                  className="block bg-surface-container-low border border-outline-variant rounded-xl p-4 hover:shadow-[0_1px_3px_0_rgba(0,0,0,0.08)] transition-shadow"
                >
                  <span className="flex items-center gap-1 font-label-caps text-label-caps uppercase text-on-surface-variant mb-1">
                    <Icon name={RELATABLE_ICON[result.type]} size={14} />
                    {t(BADGE_LABEL_KEYS[result.type])}
                  </span>
                  <h3 className="font-headline-md text-headline-md text-primary mb-1">{highlight(result.title, query)}</h3>
                  {result.excerpt && (
                    <p className="font-body-md text-body-md text-on-surface-variant line-clamp-2">
                      {highlight(result.excerpt, query)}
                    </p>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}

        {results && results.length > 0 && (
          <Pagination page={page} hasNext={hasMore} hasPrevious={page > 1} onPageChange={onPageChange} totalCount={scopedCount} />
        )}
      </div>
    </div>
  );
}
