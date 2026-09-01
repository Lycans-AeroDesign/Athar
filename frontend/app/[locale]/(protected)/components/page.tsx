"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Can } from "@/components/auth/Can";
import { ActiveFilterChip } from "@/components/ui/ActiveFilterChip";
import { Button } from "@/components/ui/Button";
import { Combobox } from "@/components/ui/Combobox";
import { Icon } from "@/components/ui/Icon";
import { Pagination } from "@/components/ui/Pagination";
import { Link } from "@/i18n/navigation";
import { getComponents } from "@/lib/api/engineering";
import { getCategories } from "@/lib/api/knowledge";
import type { Category, ComponentStatus, ComponentSummary } from "@/lib/api/types";
import { useEngineeringListFiltersEnabled } from "@/lib/auth/permissions";

const STATUS_VALUES: ComponentStatus[] = ["CERTIFIED", "TESTING", "DEPRECATED"];

const STATUS_CLASSES: Record<ComponentStatus, string> = {
  CERTIFIED: "bg-primary-container text-on-primary-container",
  TESTING: "bg-tertiary-container text-on-tertiary-container",
  DEPRECATED: "bg-error-container text-on-error-container",
};

export default function ComponentsPage() {
  const t = useTranslations("engineering.component");
  const statusT = useTranslations("engineering.componentStatus");
  const commonT = useTranslations("common");

  const filtersEnabled = useEngineeringListFiltersEnabled();
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<ComponentStatus | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  useEffect(() => {
    const handle = setTimeout(() => {
      setQuery(searchInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(handle);
  }, [searchInput]);

  // Keyed by the filter+page combination it was fetched for - see projects/page.tsx's
  // matching comment for why this avoids a plain setComponents(null) reset.
  const filterKey = `${categoryFilter ?? ""}:${statusFilter ?? ""}:${query}:${page}`;
  const [result, setResult] = useState<{
    key: string;
    components: ComponentSummary[];
    hasNext: boolean;
    count: number;
  } | null>(null);
  const components = result?.key === filterKey ? result.components : null;
  // categoriesError: the one-time mount fetch below, set at most once.
  // errorResult: keyed by filterKey like `result` above, so a stale error
  // from a previous filter combination doesn't linger once you change filters.
  const [categoriesError, setCategoriesError] = useState<string | null>(null);
  const [errorResult, setErrorResult] = useState<{ key: string; message: string } | null>(null);
  const error = categoriesError ?? (errorResult?.key === filterKey ? errorResult.message : null);

  useEffect(() => {
    getCategories().then(setCategories, (err) => setCategoriesError(err instanceof Error ? err.message : String(err)));
  }, []);

  useEffect(() => {
    getComponents({
      category: categoryFilter ?? undefined,
      status: statusFilter ?? undefined,
      q: query || undefined,
      page,
    }).then(
      (data) => setResult({ key: filterKey, components: data.results, hasNext: data.next !== null, count: data.count }),
      (err) => setErrorResult({ key: filterKey, message: err instanceof Error ? err.message : String(err) }),
    );
  }, [categoryFilter, statusFilter, query, page, filterKey]);

  function updateCategoryFilter(value: string | null) {
    setCategoryFilter(value);
    setPage(1);
  }

  function updateStatusFilter(value: ComponentStatus | null) {
    setStatusFilter(value);
    setPage(1);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-display text-on-surface">{t("listTitle")}</h1>
          <p className="font-body-lg text-body-lg text-on-surface-variant mt-2">{t("listDescription")}</p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          {filtersEnabled && (
            <div className="w-56">
              <input
                className="block w-full px-4 py-2 font-body-md text-body-md text-on-surface bg-surface-container border border-outline-variant rounded-lg focus:ring-1 focus:ring-primary focus:border-primary outline-none transition-colors"
                placeholder={commonT("searchThisList")}
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
              />
            </div>
          )}
          <div className="w-48">
            <Combobox
              placeholder={commonT("select")}
              options={[{ value: "", label: t("allCategories") }, ...categories.map((c) => ({ value: c.id, label: c.name }))]}
              value={categoryFilter ?? ""}
              onChange={(value) => updateCategoryFilter(value || null)}
            />
          </div>
          <div className="w-44">
            <Combobox
              placeholder={commonT("select")}
              options={[
                { value: "", label: statusT("all") },
                ...STATUS_VALUES.map((value) => ({ value, label: statusT(value) })),
              ]}
              value={statusFilter ?? ""}
              onChange={(value) => updateStatusFilter((value || null) as ComponentStatus | null)}
            />
          </div>
          <Can permission="component.create">
            <Link href="/components/new">
              <Button>
                <Icon name="add" size={18} />
                {t("newButton")}
              </Button>
            </Link>
          </Can>
        </div>
      </div>

      {filtersEnabled && query && (
        <div className="flex items-center gap-2">
          <ActiveFilterChip
            label={query}
            onClear={() => {
              setSearchInput("");
              setQuery("");
              setPage(1);
            }}
          />
        </div>
      )}

      {error ? (
        <p className="font-body-md text-body-md text-error" role="alert">
          {error}
        </p>
      ) : components === null ? (
        <p className="font-body-md text-body-md text-on-surface-variant">{commonT("loading")}</p>
      ) : components.length === 0 ? (
        <p className="font-body-md text-body-md text-on-surface-variant">{t("emptyState")}</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {components.map((component) => (
            <Link
              key={component.id}
              href={`/components/${component.id}`}
              className="flex flex-col bg-surface-container-low border border-outline-variant rounded-xl p-4 hover:shadow-[0_1px_3px_0_rgba(0,0,0,0.08)] transition-shadow"
            >
              <div className="flex items-center justify-between mb-2">
                {component.category && (
                  <span className="font-label-caps text-label-caps text-primary uppercase">{component.category.name}</span>
                )}
                <span
                  className={`font-label-caps text-label-caps uppercase rounded-full px-2.5 py-1 ${STATUS_CLASSES[component.status]}`}
                >
                  {statusT(component.status)}
                </span>
              </div>
              <h3 className="font-headline-md text-headline-md text-on-surface mb-1">{component.name}</h3>
              {component.part_number && (
                <p className="font-mono-sm text-mono-sm text-on-surface-variant mb-3">{component.part_number}</p>
              )}
              {component.specifications.length > 0 && (
                <div className="mt-auto grid grid-cols-2 gap-2 border-t border-outline-variant pt-2">
                  {component.specifications.slice(0, 2).map((row, i) => (
                    <div key={i}>
                      <div className="font-label-caps text-label-caps text-on-surface-variant truncate">{row.label}</div>
                      <div className="font-body-md text-body-md text-on-surface truncate">{row.value}</div>
                    </div>
                  ))}
                </div>
              )}
            </Link>
          ))}
        </div>
      )}

      {components && components.length > 0 && (
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
