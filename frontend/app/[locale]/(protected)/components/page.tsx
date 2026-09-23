"use client";

import { useTranslations } from "next-intl";
import { useEffect, useLayoutEffect, useState } from "react";

import { Can } from "@/components/auth/Can";
import { ComponentImportModal } from "@/components/engineering/ComponentImportModal";
import { ComponentsTable } from "@/components/engineering/ComponentsTable";
import { ActiveFilterChip } from "@/components/ui/ActiveFilterChip";
import { AuthenticatedImage } from "@/components/ui/AuthenticatedImage";
import { Button } from "@/components/ui/Button";
import { Combobox } from "@/components/ui/Combobox";
import { Icon } from "@/components/ui/Icon";
import { Menu, type MenuEntry } from "@/components/ui/Menu";
import { Pagination } from "@/components/ui/Pagination";
import { Link } from "@/i18n/navigation";
import { exportComponentsCsv, getComponents, type ComponentOrdering } from "@/lib/api/engineering";
import { getCategories } from "@/lib/api/knowledge";
import type { Category, ComponentStatus, ComponentSummary } from "@/lib/api/types";
import { useEngineeringListFiltersEnabled, useHasPermission } from "@/lib/auth/permissions";

const STATUS_VALUES: ComponentStatus[] = ["CERTIFIED", "TESTING", "DEPRECATED"];

const STATUS_CLASSES: Record<ComponentStatus, string> = {
  CERTIFIED: "bg-primary-container text-on-primary-container",
  TESTING: "bg-tertiary-container text-on-tertiary-container",
  DEPRECATED: "bg-error-container text-on-error-container",
};

type ViewMode = "grid" | "table";
const VIEW_MODE_STORAGE_KEY = "components-view-mode";

// useLayoutEffect (not useEffect) so the read-and-setState below runs before
// the browser paints, avoiding a grid->table flash on load, and so the
// react-hooks/set-state-in-effect lint rule (which flags a synchronous
// setState in a plain effect body) doesn't apply - same pattern as
// OrganizationProvider.tsx's own useIsomorphicLayoutEffect. Falls back to
// useEffect during SSR, where useLayoutEffect would otherwise warn.
const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

export default function ComponentsPage() {
  const t = useTranslations("engineering.component");
  const statusT = useTranslations("engineering.componentStatus");
  const commonT = useTranslations("common");

  const filtersEnabled = useEngineeringListFiltersEnabled();
  const canReadComponents = useHasPermission("component.read");
  const canCreateComponents = useHasPermission("component.create");
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<ComponentStatus | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [isImportOpen, setIsImportOpen] = useState(false);
  // Bumped after a CSV import creates at least one component, so the list
  // refetches even when the current filters/page haven't otherwise changed.
  const [refreshKey, setRefreshKey] = useState(0);
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [ordering, setOrdering] = useState<ComponentOrdering | undefined>(undefined);

  // Read after mount, not as the initial useState value - the server-rendered
  // HTML has no access to localStorage, so starting from "grid" always keeps
  // hydration consistent; this just switches it right after if a preference
  // was saved. A saved "table" preference is ignored on a narrow viewport -
  // a dense, horizontally-scrolling table isn't a good fit there, so mobile
  // always starts from grid regardless of what was picked on a wider screen
  // (matches Tailwind's `md` breakpoint, used the same way elsewhere in the
  // app for "mobile vs. desktop" layout decisions).
  useIsomorphicLayoutEffect(() => {
    const isMobileViewport = window.matchMedia("(max-width: 767px)").matches;
    try {
      const saved = window.localStorage.getItem(VIEW_MODE_STORAGE_KEY);
      if ((saved === "grid" || saved === "table") && !(isMobileViewport && saved === "table")) {
        setViewMode(saved);
      }
    } catch {
      // Private browsing / storage disabled - just keep the "grid" default.
    }
  }, []);

  function updateViewMode(mode: ViewMode) {
    setViewMode(mode);
    try {
      window.localStorage.setItem(VIEW_MODE_STORAGE_KEY, mode);
    } catch {
      // Private browsing / quota exceeded - the choice just won't persist.
    }
  }

  useEffect(() => {
    const handle = setTimeout(() => {
      setQuery(searchInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(handle);
  }, [searchInput]);

  // Keyed by the filter+page combination it was fetched for - see projects/page.tsx's
  // matching comment for why this avoids a plain setComponents(null) reset.
  const filterKey = `${categoryFilter ?? ""}:${statusFilter ?? ""}:${query}:${page}:${refreshKey}:${ordering ?? ""}`;
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
      ordering,
    }).then(
      (data) => setResult({ key: filterKey, components: data.results, hasNext: data.next !== null, count: data.count }),
      (err) => setErrorResult({ key: filterKey, message: err instanceof Error ? err.message : String(err) }),
    );
  }, [categoryFilter, statusFilter, query, page, filterKey, refreshKey, ordering]);

  function updateCategoryFilter(value: string | null) {
    setCategoryFilter(value);
    setPage(1);
  }

  function updateStatusFilter(value: ComponentStatus | null) {
    setStatusFilter(value);
    setPage(1);
  }

  function updateOrdering(value: ComponentOrdering) {
    setOrdering(value);
    setPage(1);
  }

  // Exports whatever the current filters show, not always the whole
  // library - see backend ComponentExportView's own docstring.
  async function handleExport() {
    if (isExporting) return;
    setIsExporting(true);
    setExportError(null);
    try {
      await exportComponentsCsv({
        category: categoryFilter ?? undefined,
        status: statusFilter ?? undefined,
        q: query || undefined,
        ordering,
      });
    } catch (err) {
      setExportError(t("exportError", { message: err instanceof Error ? err.message : String(err) }));
    } finally {
      setIsExporting(false);
    }
  }

  const actionsMenuItems: MenuEntry[] = [
    ...(canReadComponents
      ? [{ label: isExporting ? commonT("working") : t("exportCsvButton"), icon: "upload", onSelect: handleExport }]
      : []),
    ...(canCreateComponents
      ? [{ label: t("importCsvButton"), icon: "download", onSelect: () => setIsImportOpen(true) }]
      : []),
  ];

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
                className="block w-full h-10 px-4 py-2 font-body-md text-body-md text-on-surface bg-surface-container border border-outline-variant rounded-lg focus:ring-1 focus:ring-primary focus:border-primary outline-none transition-colors"
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
              triggerClassName="h-10"
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
              triggerClassName="h-10"
            />
          </div>
          <div className="relative flex h-10 items-center gap-1 rounded-lg border border-outline-variant p-1">
            {/* Sliding highlight, not a per-button background swap - a
                physical translate-x, so it needs an rtl: mirror since Arabic
                visually reverses which side "grid" vs "table" sits on. */}
            <div
              aria-hidden
              className={`absolute inset-y-1 start-1 h-8 w-8 rounded-md bg-primary-container transition-transform duration-200 ease-out ${
                viewMode === "table" ? "translate-x-9 rtl:-translate-x-9" : "translate-x-0"
              }`}
            />
            <button
              type="button"
              aria-label={t("gridViewLabel")}
              aria-pressed={viewMode === "grid"}
              onClick={() => updateViewMode("grid")}
              className={`relative z-10 flex h-8 w-8 items-center justify-center rounded-md outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${
                viewMode === "grid" ? "text-on-primary-container" : "text-on-surface-variant hover:text-on-surface"
              }`}
            >
              <Icon name="grid_view" size={18} />
            </button>
            <button
              type="button"
              aria-label={t("tableViewLabel")}
              aria-pressed={viewMode === "table"}
              onClick={() => updateViewMode("table")}
              className={`relative z-10 flex h-8 w-8 items-center justify-center rounded-md outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${
                viewMode === "table" ? "text-on-primary-container" : "text-on-surface-variant hover:text-on-surface"
              }`}
            >
              <Icon name="table_chart" size={18} />
            </button>
          </div>
          {actionsMenuItems.length > 0 && (
            <Menu
              trigger={
                <Button variant="secondary" aria-label={t("actionsMenuLabel")} className="!px-2 h-10">
                  <Icon name="more_vert" size={18} />
                </Button>
              }
              items={actionsMenuItems}
            />
          )}
          <Can permission="component.create">
            <Link href="/components/new">
              <Button className="h-10">
                <Icon name="add" size={18} />
                {t("newButton")}
              </Button>
            </Link>
          </Can>
        </div>
      </div>

      {exportError && (
        <p className="font-body-md text-body-md text-error" role="alert">
          {exportError}
        </p>
      )}

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
        // Keying by viewMode remounts this on toggle, replaying the fade-in
        // instead of an abrupt cut between the grid and table layouts.
        <div key={viewMode} className="animate-fade-in-up">
          {viewMode === "table" ? (
            <ComponentsTable components={components} ordering={ordering} onOrderingChange={updateOrdering} />
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
                      <span className="font-label-caps text-label-caps text-primary uppercase">
                        {component.category.name}
                      </span>
                    )}
                    <span
                      className={`font-label-caps text-label-caps uppercase rounded-full px-2.5 py-1 ${STATUS_CLASSES[component.status]}`}
                    >
                      {statusT(component.status)}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 mb-1">
                    {component.photo && (
                      <div className="h-10 w-10 rounded-lg border border-outline-variant overflow-hidden shrink-0">
                        <AuthenticatedImage
                          src={component.photo.download_url}
                          alt={component.name}
                          className="h-full w-full object-cover"
                        />
                      </div>
                    )}
                    <h3 className="font-headline-md text-headline-md text-on-surface truncate">{component.name}</h3>
                  </div>
                  <div className="flex items-center justify-between gap-2 mb-3">
                    {component.part_number && (
                      <p className="font-mono-sm text-mono-sm text-on-surface-variant truncate">{component.part_number}</p>
                    )}
                    <span
                      className={`font-mono-sm text-mono-sm shrink-0 ms-auto ${
                        component.quantity_available > 0 ? "text-on-surface-variant" : "text-error"
                      }`}
                    >
                      {t("quantityInStock", { count: component.quantity_available })}
                    </span>
                  </div>
                  {component.specifications.length > 0 && (
                    <div className="mt-auto grid grid-cols-2 gap-2 border-t border-outline-variant pt-2">
                      {component.specifications.slice(0, 2).map((row, i) => (
                        <div key={i}>
                          <div className="font-label-caps text-label-caps text-on-surface-variant truncate">
                            {row.label}
                          </div>
                          <div className="font-body-md text-body-md text-on-surface truncate">{row.value}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </Link>
              ))}
            </div>
          )}
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

      <ComponentImportModal
        open={isImportOpen}
        onOpenChange={setIsImportOpen}
        onImported={() => setRefreshKey((key) => key + 1)}
      />
    </div>
  );
}
