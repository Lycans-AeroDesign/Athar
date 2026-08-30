"use client";

import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type ReactNode } from "react";

import { Icon } from "@/components/ui/Icon";
import { Pagination } from "@/components/ui/Pagination";
import { Link, useRouter } from "@/i18n/navigation";
import { searchKnowledge } from "@/lib/api/knowledge";
import type { SearchResult } from "@/lib/api/types";

type Scope = "all" | "article" | "question";

const SCOPE_OPTIONS: { value: Scope; labelKey: string }[] = [
  { value: "all", labelKey: "filterAll" },
  { value: "article", labelKey: "filterArticles" },
  { value: "question", labelKey: "filterQuestions" },
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
  const page = Number(searchParams.get("page") ?? "1");

  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!query.trim()) return;
    searchKnowledge(query, scope === "all" ? undefined : scope, page)
      .then((data) => {
        setResults(data.results);
        setHasMore(data.hasMore);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [query, scope, page]);

  function updateParams(next: { type?: Scope; page?: number }) {
    const params = new URLSearchParams();
    params.set("q", query);
    const nextType = next.type ?? scope;
    if (nextType !== "all") params.set("type", nextType);
    const nextPage = next.page ?? 1;
    if (nextPage > 1) params.set("page", String(nextPage));
    router.push(`/knowledge/search?${params.toString()}`);
  }

  return (
    <div className="space-y-6">
      <h1 className="font-display text-display text-on-surface">
        {query ? t("titleWithQuery", { query }) : t("title")}
      </h1>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-3 space-y-2">
          <h2 className="font-label-caps text-label-caps uppercase text-on-surface-variant px-3">
            {t("filtersTitle")}
          </h2>
          <ul className="space-y-1">
            {SCOPE_OPTIONS.map((option) => (
              <li key={option.value}>
                <button
                  type="button"
                  onClick={() => updateParams({ type: option.value, page: 1 })}
                  className={`w-full text-start px-3 py-2 rounded-lg font-body-md text-body-md transition-colors ${
                    scope === option.value
                      ? "bg-primary/10 text-primary"
                      : "text-on-surface-variant hover:bg-surface-variant"
                  }`}
                >
                  {t(option.labelKey)}
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="lg:col-span-9 space-y-4">
          {error && (
            <p className="font-body-md text-body-md text-error" role="alert">
              {error}
            </p>
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
                    href={
                      result.type === "article"
                        ? `/knowledge/articles/${result.id}`
                        : `/knowledge/questions/${result.id}`
                    }
                    className="block bg-surface-container-low border border-outline-variant rounded-xl p-4 hover:shadow-[0_1px_3px_0_rgba(0,0,0,0.08)] transition-shadow"
                  >
                    <span className="flex items-center gap-1 font-label-caps text-label-caps uppercase text-on-surface-variant mb-1">
                      <Icon name={result.type === "article" ? "menu_book" : "forum"} size={14} />
                      {result.type === "article" ? t("badgeArticle") : t("badgeQuestion")}
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
            />
          )}
        </div>
      </div>
    </div>
  );
}
