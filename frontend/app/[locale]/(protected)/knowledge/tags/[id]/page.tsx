"use client";

import { useTranslations } from "next-intl";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { EMPTY_SEARCH_COUNTS, SearchResultsPanel, type SearchCounts, type SearchScope } from "@/components/knowledge/SearchResultsPanel";
import { useRouter } from "@/i18n/navigation";
import { getItemsByTag } from "@/lib/api/knowledge";
import type { SearchResult, Tag } from "@/lib/api/types";

// "Browse everything tagged X" - reuses the same backend endpoint/response
// shape as the text-search page (see backend/knowledge/views.py's
// SearchView, ?tag= instead of ?q=) and the same filter-sidebar/result-list/
// pagination UI (SearchResultsPanel), just triggered from a tag id in the
// route instead of a typed query.
export default function TagItemsPage() {
  return (
    <Suspense>
      <TagItems />
    </Suspense>
  );
}

function TagItems() {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations("knowledge.tagPage");
  const searchParams = useSearchParams();
  const router = useRouter();

  const scope = (searchParams.get("type") as SearchScope | null) ?? "all";
  const page = Number(searchParams.get("page") ?? "1");

  const [tag, setTag] = useState<Tag | null>(null);
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [counts, setCounts] = useState<SearchCounts>(EMPTY_SEARCH_COUNTS);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    getItemsByTag(id, scope === "all" ? undefined : scope, page).then(
      (data) => {
        setTag(data.tag);
        setResults(data.results);
        setHasMore(data.hasMore);
        setCounts(data.counts);
      },
      () => setNotFound(true),
    );
  }, [id, scope, page]);

  function updateParams(next: { type?: SearchScope; page?: number }) {
    const params = new URLSearchParams();
    const nextType = next.type ?? scope;
    if (nextType !== "all") params.set("type", nextType);
    const nextPage = next.page ?? 1;
    if (nextPage > 1) params.set("page", String(nextPage));
    const suffix = params.toString() ? `?${params.toString()}` : "";
    router.push(`/knowledge/tags/${id}${suffix}`);
  }

  if (notFound) {
    return <p className="font-body-md text-body-md text-error">{t("notFound")}</p>;
  }

  return (
    <div className="space-y-6">
      <div>
        {tag && (
          <p className="font-label-caps text-label-caps text-on-surface-variant uppercase">{t("eyebrow")}</p>
        )}
        <h1 className="font-display text-display text-on-surface">{tag ? `#${tag.name}` : t("loading")}</h1>
      </div>

      <SearchResultsPanel
        results={results}
        counts={counts}
        scope={scope}
        onScopeChange={(nextScope) => updateParams({ type: nextScope, page: 1 })}
        emptyMessage={tag ? t("emptyState", { name: tag.name }) : t("loading")}
        loadingMessage={t("loading")}
        page={page}
        hasMore={hasMore}
        onPageChange={(nextPage) => updateParams({ page: nextPage })}
      />
    </div>
  );
}
