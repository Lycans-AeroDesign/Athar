"use client";

import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type ReactNode } from "react";

import { ActiveFilterChip } from "@/components/ui/ActiveFilterChip";
import { Icon } from "@/components/ui/Icon";
import { Pagination } from "@/components/ui/Pagination";
import { Link, useRouter } from "@/i18n/navigation";
import { searchKnowledge, type SearchCounts, type SearchSort } from "@/lib/api/knowledge";
import type { RelatableType, SearchResult } from "@/lib/api/types";
import { RELATABLE_ICON, RELATABLE_ROUTE_PREFIX } from "@/lib/knowledgeTypes";

type Scope = "all" | RelatableType;

// Every relatable type SearchView actually searches (see backend/knowledge/views.py's
// SearchView) - kept in this order (matches SideNav/RELATABLE_ICON) so the filter
// list and result badges cover the same six types the API's `counts` returns.
const CONTENT_TYPES: RelatableType[] = ["article", "question", "project", "component", "failure", "sop"];

const FILTER_LABEL_KEYS: Record<RelatableType, string> = {
  article: "filterArticles",
  question: "filterQuestions",
  project: "filterProjects",
  component: "filterComponents",
  failure: "filterFailures",
  sop: "filterSops",
};

const BADGE_LABEL_KEYS: Record<RelatableType, string> = {
  article: "badgeArticle",
  question: "badgeQuestion",
  project: "badgeProject",
  component: "badgeComponent",
  failure: "badgeFailure",
  sop: "badgeSop",
};

const SCOPE_OPTIONS: { value: Scope; labelKey: string }[] = [
  { value: "all", labelKey: "filterAll" },
  ...CONTENT_TYPES.map((value) => ({ value, labelKey: FILTER_LABEL_KEYS[value] })),
];

const EMPTY_COUNTS: SearchCounts = { article: 0, question: 0, project: 0, component: 0, failure: 0, sop: 0 };

const SORT_OPTIONS: { value: SearchSort; labelKey: string }[] = [
  { value: "newest", labelKey: "sortNewest" },
  { value: "oldest", labelKey: "sortOldest" },
];

// Wraps <mark> around every case-insensitive occurrence of `query` inside
// `text` - no scoring/relevance behind this (see SearchView's plain icontains
// query), just a visual aid for why a result matched.
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

export default function SearchResultsPage() {
  return (
    <Suspense>
      <SearchResults />
    </Suspense>
  );
}

function SearchResults() {
  const t = useTranslations("knowledge.search");
  const searchParams = useSearchParams();
  const router = useRouter();

  const query = searchParams.get("q") ?? "";
  const scope = (searchParams.get("type") as Scope | null) ?? "all";
  const sort = (searchParams.get("sort") as SearchSort | null) ?? "newest";
  const page = Number(searchParams.get("page") ?? "1");

  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [counts, setCounts] = useState<SearchCounts>(EMPTY_COUNTS);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!query.trim()) return;
    searchKnowledge(query, scope === "all" ? undefined : scope, page, sort)
      .then((data) => {
        setResults(data.results);
        setHasMore(data.hasMore);
        setCounts(data.counts);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [query, scope, page, sort]);

  function updateParams(next: { type?: Scope; sort?: SearchSort; page?: number }) {
    const params = new URLSearchParams();
    params.set("q", query);
    const nextType = next.type ?? scope;
    if (nextType !== "all") params.set("type", nextType);
    const nextSort = next.sort ?? sort;
    if (nextSort !== "newest") params.set("sort", nextSort);
    const nextPage = next.page ?? 1;
    if (nextPage > 1) params.set("page", String(nextPage));
    router.push(`/knowledge/search?${params.toString()}`);
  }

  const totalCount = CONTENT_TYPES.reduce((sum, type) => sum + counts[type], 0);
  const scopedCount = scope === "all" ? totalCount : counts[scope];

  return (
    <div className="space-y-6">
      <h1 className="font-display text-display text-on-surface">
        {query ? t("titleWithQuery", { query }) : t("title")}
      </h1>

      {scope !== "all" && (
        <div className="flex items-center gap-2">
          <ActiveFilterChip label={t(FILTER_LABEL_KEYS[scope])} onClear={() => updateParams({ type: "all", page: 1 })} />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <aside className="lg:col-span-3 space-y-4">
          <h2 className="font-label-caps text-label-caps uppercase text-on-surface-variant px-3">
            {t("filtersTitle")}
          </h2>
          <div className="space-y-2">
            <h3 className="font-body-md text-body-md font-bold text-on-surface px-3">{t("contentTypeTitle")}</h3>
            <ul className="space-y-1">
              {SCOPE_OPTIONS.map((option) => {
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
                        onChange={() => updateParams({ type: option.value, page: 1 })}
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
          {error && (
            <p className="font-body-md text-body-md text-error" role="alert">
              {error}
            </p>
          )}

          {query.trim() && results !== null && results.length > 0 && (
            <div className="flex items-center justify-end gap-2">
              <span className="font-label-caps text-label-caps text-on-surface-variant uppercase">
                {t("sortByLabel")}
              </span>
              <select
                value={sort}
                onChange={(e) => updateParams({ sort: e.target.value as SearchSort, page: 1 })}
                className="bg-transparent border-none font-body-md text-body-md text-primary font-bold focus:ring-0 cursor-pointer py-0 ps-0 pe-6"
              >
                {SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {t(option.labelKey)}
                  </option>
                ))}
              </select>
            </div>
          )}

          {!query.trim() ? (
            <p className="font-body-md text-body-md text-on-surface-variant">{t("emptyQuery")}</p>
          ) : results === null ? (
            <p className="font-body-md text-body-md text-on-surface-variant">{t("loading")}</p>
          ) : results.length === 0 ? (
            <p className="font-body-md text-body-md text-on-surface-variant">{t("noResults", { query })}</p>
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
                    <h3 className="font-headline-md text-headline-md text-primary mb-1">
                      {highlight(result.title, query)}
                    </h3>
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
            <Pagination
              page={page}
              hasNext={hasMore}
              hasPrevious={page > 1}
              onPageChange={(nextPage) => updateParams({ page: nextPage })}
              totalCount={scopedCount}
            />
          )}
        </div>
      </div>
    </div>
  );
}
