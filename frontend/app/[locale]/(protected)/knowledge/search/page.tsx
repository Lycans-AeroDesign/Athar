"use client";

import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import {
  EMPTY_SEARCH_COUNTS,
  SEARCH_FILTER_LABEL_KEYS,
  SearchResultsPanel,
  type SearchCounts,
  type SearchScope,
} from "@/components/knowledge/SearchResultsPanel";
import { ActiveFilterChip } from "@/components/ui/ActiveFilterChip";
import { useRouter } from "@/i18n/navigation";
import { searchKnowledge, type SearchSort } from "@/lib/api/knowledge";
import type { SearchResult } from "@/lib/api/types";

const SORT_OPTIONS: { value: SearchSort; labelKey: string }[] = [
  { value: "relevance", labelKey: "sortRelevance" },
  { value: "newest", labelKey: "sortNewest" },
  { value: "oldest", labelKey: "sortOldest" },
];

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
  const scope = (searchParams.get("type") as SearchScope | null) ?? "all";
  const sort = (searchParams.get("sort") as SearchSort | null) ?? "relevance";
  const page = Number(searchParams.get("page") ?? "1");

  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [counts, setCounts] = useState<SearchCounts>(EMPTY_SEARCH_COUNTS);
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

  function updateParams(next: { type?: SearchScope; sort?: SearchSort; page?: number }) {
    const params = new URLSearchParams();
    params.set("q", query);
    const nextType = next.type ?? scope;
    if (nextType !== "all") params.set("type", nextType);
    const nextSort = next.sort ?? sort;
    if (nextSort !== "relevance") params.set("sort", nextSort);
    const nextPage = next.page ?? 1;
    if (nextPage > 1) params.set("page", String(nextPage));
    router.push(`/knowledge/search?${params.toString()}`);
  }

  return (
    <div className="space-y-6">
      <h1 className="font-display text-display text-on-surface">
        {query ? t("titleWithQuery", { query }) : t("title")}
      </h1>

      {scope !== "all" && (
        <div className="flex items-center gap-2">
          <ActiveFilterChip label={t(SEARCH_FILTER_LABEL_KEYS[scope])} onClear={() => updateParams({ type: "all", page: 1 })} />
        </div>
      )}

      {error && (
        <p className="font-body-md text-body-md text-error" role="alert">
          {error}
        </p>
      )}

      {!query.trim() ? (
        <p className="font-body-md text-body-md text-on-surface-variant">{t("emptyQuery")}</p>
      ) : (
        <SearchResultsPanel
          results={results}
          counts={counts}
          scope={scope}
          onScopeChange={(nextScope) => updateParams({ type: nextScope, page: 1 })}
          query={query}
          emptyMessage={t("noResults", { query })}
          loadingMessage={t("loading")}
          page={page}
          hasMore={hasMore}
          onPageChange={(nextPage) => updateParams({ page: nextPage })}
          headerExtra={
            results !== null &&
            results.length > 0 && (
              <div className="flex items-center justify-end gap-2">
                <span className="font-label-caps text-label-caps text-on-surface-variant uppercase">{t("sortByLabel")}</span>
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
            )
          }
        />
      )}
    </div>
  );
}
