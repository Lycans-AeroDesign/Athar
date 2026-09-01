"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { Icon } from "@/components/ui/Icon";
import { Menu } from "@/components/ui/Menu";
import { usePathname, useRouter } from "@/i18n/navigation";
import { searchKnowledge } from "@/lib/api/knowledge";
import type { RelatableType, SearchResult } from "@/lib/api/types";
import { useEngineeringListFiltersEnabled } from "@/lib/auth/permissions";
import { RELATABLE_ICON, RELATABLE_ROUTE_PREFIX } from "@/lib/knowledgeTypes";

type Scope = "all" | RelatableType;

// Every relatable type SearchView actually searches - kept in sync with
// knowledge/search/page.tsx's CONTENT_TYPES so the scope menu here covers
// the same types that page's filter list does.
const CONTENT_TYPES: RelatableType[] = [
  "article",
  "question",
  "project",
  "component",
  "failure",
  "sop",
  "test",
  "document",
];

const SCOPE_LABEL_KEYS: Record<Scope, string> = {
  all: "searchScopeAll",
  article: "searchScopeArticles",
  question: "searchScopeQuestions",
  project: "searchScopeProjects",
  component: "searchScopeComponents",
  failure: "searchScopeFailures",
  sop: "searchScopeSops",
  test: "searchScopeTests",
  document: "searchScopeDocuments",
};

// Pathname prefix -> the scope that page's own content lives under, so the
// bar auto-narrows to match wherever you already are (a search typed while
// looking at Failures has no reason to default to hunting through SOPs).
// `/knowledge/search` itself is deliberately excluded - that page manages
// its own scope from the URL, not from wherever you were before landing on it.
const SCOPE_BY_PATH_PREFIX: [prefix: string, scope: RelatableType][] = [
  ["/knowledge/articles", "article"],
  ["/knowledge/questions", "question"],
  ["/projects", "project"],
  ["/components", "component"],
  ["/failures", "failure"],
  ["/sops", "sop"],
  ["/tests", "test"],
  ["/documents", "document"],
];

function scopeForPathname(pathname: string): Scope {
  return SCOPE_BY_PATH_PREFIX.find(([prefix]) => pathname.startsWith(prefix))?.[1] ?? "all";
}

// The one global search bar (see TopBar.tsx) - searches every relatable type
// together, with a scope dropdown to narrow to a single one. Debounced live
// results in a dropdown; picking one or hitting Enter navigates straight to
// it rather than to a separate results page.
export function GlobalSearch() {
  const t = useTranslations("topbar");
  const commonT = useTranslations("common");
  const router = useRouter();
  const pathname = usePathname();
  const containerRef = useRef<HTMLDivElement>(null);
  // Same preference that gates the list pages' own search box (Account >
  // Settings > Preferences) - off means no filter gets added automatically
  // anywhere, so the bar always starts from "all" here too. A manual pick
  // from the dropdown below still works regardless; this only governs the
  // automatic part.
  const autoScopeEnabled = useEngineeringListFiltersEnabled();

  const [query, setQuery] = useState("");
  // Keyed by the pathname it was picked on, rather than reset with a plain
  // setScope(...) in a pathname-watching effect - see knowledge/page.tsx's
  // status-filter effect for why (that pattern runs setState synchronously
  // in the effect body, which React's lint rule flags). A manual pick from
  // the dropdown below sticks for as long as you stay on this page; once you
  // navigate elsewhere the override's pathname no longer matches and it
  // falls back to the auto-detected scope (or "all", if that's disabled) below.
  const [manualScope, setManualScope] = useState<{ pathname: string; scope: Scope } | null>(null);
  const scope =
    manualScope?.pathname === pathname ? manualScope.scope : autoScopeEnabled ? scopeForPathname(pathname) : "all";
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
    router.push(`${RELATABLE_ROUTE_PREFIX[result.type]}/${result.id}`);
  }

  const scopeLabels: Record<Scope, string> = {
    all: t(SCOPE_LABEL_KEYS.all),
    article: t(SCOPE_LABEL_KEYS.article),
    question: t(SCOPE_LABEL_KEYS.question),
    project: t(SCOPE_LABEL_KEYS.project),
    component: t(SCOPE_LABEL_KEYS.component),
    failure: t(SCOPE_LABEL_KEYS.failure),
    sop: t(SCOPE_LABEL_KEYS.sop),
    test: t(SCOPE_LABEL_KEYS.test),
    document: t(SCOPE_LABEL_KEYS.document),
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
      <div className="absolute end-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
        <Menu
          align="end"
          trigger={
            <button
              type="button"
              className={`flex items-center gap-1 px-2 py-1 rounded-full font-label-caps text-label-caps uppercase transition-colors ${
                scope === "all"
                  ? "text-on-surface-variant hover:bg-surface-variant"
                  : "bg-primary/10 text-primary border border-primary/20"
              }`}
            >
              {scopeLabels[scope]}
              <Icon name="expand_more" size={16} />
            </button>
          }
          items={(["all", ...CONTENT_TYPES] as Scope[]).map((value) => ({
            label: scopeLabels[value],
            onSelect: () => setManualScope({ pathname, scope: value }),
          }))}
        />
        {/* A removable "pill" once a scope is active - clicking it clears
            straight back to "all" without reopening the Menu above, which
            stays for *picking* a scope. */}
        {scope !== "all" && (
          <button
            type="button"
            onClick={() => setManualScope({ pathname, scope: "all" })}
            aria-label={commonT("removeFilter")}
            className="rounded-full p-1 text-primary hover:bg-primary/20 transition-colors"
          >
            <Icon name="close" size={14} />
          </button>
        )}
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
                      name={RELATABLE_ICON[result.type]}
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
