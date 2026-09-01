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
import { getProjects } from "@/lib/api/engineering";
import type { ProjectStatus, ProjectSummary } from "@/lib/api/types";
import { useEngineeringListFiltersEnabled } from "@/lib/auth/permissions";

const STATUS_VALUES: ProjectStatus[] = ["ACTIVE", "ON_HOLD", "COMPLETED"];

const STATUS_CLASSES: Record<ProjectStatus, string> = {
  ACTIVE: "bg-primary-container text-on-primary-container",
  ON_HOLD: "bg-tertiary-container text-on-tertiary-container",
  COMPLETED: "bg-surface-variant text-on-surface-variant",
};

export default function ProjectsPage() {
  const t = useTranslations("engineering.project");
  const statusT = useTranslations("engineering.projectStatus");
  const commonT = useTranslations("common");
  const filtersEnabled = useEngineeringListFiltersEnabled();

  const [statusFilter, setStatusFilter] = useState<ProjectStatus | null>(null);
  // Raw input vs. debounced query, same split as RelatedContent.tsx's picker
  // search - avoids firing a request on every keystroke.
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

  // Keyed by the filter+page combination it was fetched for, rather than
  // reset with a plain setProjects(null) at the top of the effect below - see
  // knowledge/page.tsx's status-filter effect for why (that pattern runs
  // setState synchronously in the effect body, which React's lint rule flags).
  const filterKey = `${statusFilter ?? ""}:${query}:${page}`;
  const [result, setResult] = useState<{ key: string; projects: ProjectSummary[]; hasNext: boolean; count: number } | null>(
    null,
  );
  const projects = result?.key === filterKey ? result.projects : null;
  // Same keyed-by-filterKey pattern as `result` above, so a stale error from
  // a previous filter combination doesn't linger once you change filters -
  // whichever of result/errorResult actually matches the current filterKey wins.
  const [errorResult, setErrorResult] = useState<{ key: string; message: string } | null>(null);
  const error = errorResult?.key === filterKey ? errorResult.message : null;

  useEffect(() => {
    getProjects({ status: statusFilter ?? undefined, q: query || undefined, page }).then(
      (data) => setResult({ key: filterKey, projects: data.results, hasNext: data.next !== null, count: data.count }),
      (err) => setErrorResult({ key: filterKey, message: err instanceof Error ? err.message : String(err) }),
    );
  }, [statusFilter, query, page, filterKey]);

  function updateStatusFilter(value: ProjectStatus | null) {
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
        <div className="flex items-end gap-3">
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
              placeholder={statusT("all")}
              options={[
                { value: "", label: statusT("all") },
                ...STATUS_VALUES.map((value) => ({ value, label: statusT(value) })),
              ]}
              value={statusFilter ?? ""}
              onChange={(value) => updateStatusFilter((value || null) as ProjectStatus | null)}
            />
          </div>
          <Can permission="project.create">
            <Link href="/projects/new">
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
      ) : projects === null ? (
        <p className="font-body-md text-body-md text-on-surface-variant">{commonT("loading")}</p>
      ) : projects.length === 0 ? (
        <p className="font-body-md text-body-md text-on-surface-variant">{t("emptyState")}</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {projects.map((project) => (
            <Link
              key={project.id}
              href={`/projects/${project.id}`}
              className="block bg-surface-container-low border border-outline-variant rounded-xl p-4 hover:shadow-[0_1px_3px_0_rgba(0,0,0,0.08)] transition-shadow"
            >
              <div className="flex items-center justify-between mb-2">
                <span
                  className={`font-label-caps text-label-caps uppercase rounded-full px-2.5 py-1 ${STATUS_CLASSES[project.status]}`}
                >
                  {statusT(project.status)}
                </span>
              </div>
              <h3 className="font-headline-md text-headline-md text-primary mb-2">{project.name}</h3>
              {project.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {project.tags.map((tag) => (
                    <span
                      key={tag.id}
                      className="font-mono-sm text-mono-sm text-on-surface-variant bg-surface-container px-2 py-0.5 rounded-full border border-outline-variant"
                    >
                      {tag.name}
                    </span>
                  ))}
                </div>
              )}
            </Link>
          ))}
        </div>
      )}

      {projects && projects.length > 0 && (
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
