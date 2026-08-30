"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { Icon } from "@/components/ui/Icon";
import { Menu } from "@/components/ui/Menu";
import { useRouter } from "@/i18n/navigation";
import { searchKnowledge } from "@/lib/api/knowledge";
import type { SearchResult } from "@/lib/api/types";

type Scope = "all" | "article" | "question";

// The one global search bar (see TopBar.tsx) - searches articles and
// questions together, with a scope dropdown to narrow to a single section.
// Debounced live results in a dropdown; picking one or hitting Enter
// navigates straight to it rather than to a separate results page.
export function GlobalSearch() {
  const t = useTranslations("topbar");
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);

  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<Scope>("all");
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isSearching, setIsSearching] = useState(false);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) return;
    const handle = setTimeout(() => {
      setIsSearching(true);
      searchKnowledge(trimmed, scope === "all" ? undefined : scope)
        .then((data) => {
          setResults(data.results);
          setIsOpen(true);
        })
        .finally(() => setIsSearching(false));
    }, 300);
    return () => clearTimeout(handle);
  }, [query, scope]);

  function goToSearchPage() {
    const trimmed = query.trim();
    if (!trimmed) return;
    setIsOpen(false);
    const params = new URLSearchParams({ q: trimmed });
    if (scope !== "all") params.set("type", scope);
    router.push(`/knowledge/search?${params.toString()}`);
  }

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function handleSelect(result: SearchResult) {
    setIsOpen(false);
    setQuery("");
    setResults(null);
    router.push(result.type === "article" ? `/knowledge/articles/${result.id}` : `/knowledge/questions/${result.id}`);
  }

  const scopeLabels: Record<Scope, string> = {
    all: t("searchScopeAll"),
    article: t("searchScopeArticles"),
    question: t("searchScopeQuestions"),
  };

  return (
    <div ref={containerRef} className="relative w-full">
      <Icon name="search" className="absolute start-4 top-1/2 -translate-y-1/2 text-outline" />
      <input
        className="w-full bg-surface-container-low border border-outline-variant rounded-xl py-2 ps-[40px] pe-32 text-body-md font-body-md text-on-surface placeholder:text-outline focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
        placeholder={t("searchPlaceholder")}
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => results && setIsOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setIsOpen(false);
          if (e.key === "Enter") goToSearchPage();
        }}
      />
      <div className="absolute end-2 top-1/2 -translate-y-1/2">
        <Menu
          align="end"
          trigger={
            <button
              type="button"
              className="flex items-center gap-1 px-2 py-1 rounded-lg font-label-caps text-label-caps uppercase text-on-surface-variant hover:bg-surface-variant transition-colors"
            >
              {scopeLabels[scope]}
              <Icon name="expand_more" size={16} />
            </button>
          }
          items={(["all", "article", "question"] as Scope[]).map((value) => ({
            label: scopeLabels[value],
            onSelect: () => setScope(value),
          }))}
        />
      </div>

      {isOpen && query.trim() && (
        <div className="absolute top-full mt-2 start-0 end-0 bg-surface-container-lowest border border-outline-variant rounded-xl shadow-[0_4px_16px_0_rgba(0,0,0,0.12)] max-h-[400px] overflow-y-auto z-50">
          {isSearching ? (
            <p className="px-4 py-3 font-body-md text-body-md text-on-surface-variant">{t("searching")}</p>
          ) : !results || results.length === 0 ? (
            <p className="px-4 py-3 font-body-md text-body-md text-on-surface-variant">{t("noSearchResults")}</p>
          ) : (
            <ul className="py-1">
              {results.map((result) => (
                <li key={`${result.type}-${result.id}`}>
                  <button
                    type="button"
                    onClick={() => handleSelect(result)}
                    className="flex w-full items-start gap-3 px-4 py-2.5 text-start hover:bg-surface-variant transition-colors"
                  >
                    <Icon
                      name={result.type === "article" ? "menu_book" : "forum"}
                      size={18}
                      className="mt-0.5 text-on-surface-variant shrink-0"
                    />
                    <span className="min-w-0">
                      <span className="block font-body-md text-body-md text-on-surface truncate">
                        {result.title}
                      </span>
                      {result.excerpt && (
                        <span className="block font-body-md text-body-md text-on-surface-variant truncate">
                          {result.excerpt}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
              <li className="border-t border-outline-variant mt-1 pt-1">
                <button
                  type="button"
                  onClick={goToSearchPage}
                  className="w-full px-4 py-2.5 text-start font-label-caps text-label-caps uppercase text-primary hover:bg-surface-variant transition-colors"
                >
                  {t("seeAllResults", { query })}
                </button>
              </li>
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
