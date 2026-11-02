"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Can } from "@/components/auth/Can";
import { ActiveFilterChip } from "@/components/ui/ActiveFilterChip";
import { Button } from "@/components/ui/Button";
import { Combobox } from "@/components/ui/Combobox";
import { EmptyState } from "@/components/ui/EmptyState";
import { Icon } from "@/components/ui/Icon";
import { Pagination } from "@/components/ui/Pagination";
import { PROJECT_CARD_GRID, ProjectCard, ProjectCardGridSkeleton } from "@/components/engineering/ProjectCard";
import { INPUT_CLASS } from "@/components/ui/inputStyles";
import { Link } from "@/i18n/navigation";
import { getProjects } from "@/lib/api/engineering";
import type { ProjectCard as ProjectCardData, ProjectStatus } from "@/lib/api/types";
import { useEngineeringListFiltersEnabled } from "@/lib/auth/permissions";
import { errorMessage } from "@/lib/errors";
import { PROJECT_STATUS_ICONS } from "@/lib/optionIcons";

const STATUS_VALUES: ProjectStatus[] = ["ACTIVE", "ON_HOLD", "COMPLETED"];

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
  const [result, setResult] = useState<{ key: string; projects: ProjectCardData[]; hasNext: boolean; count: number } | null>(
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
      (err) => setErrorResult({ key: filterKey, message: errorMessage(err) }),
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
                className={INPUT_CLASS}
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
                ...STATUS_VALUES.map((value) => ({ value, label: statusT(value), ...PROJECT_STATUS_ICONS[value] })),
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
        <ProjectCardGridSkeleton />
      ) : projects.length === 0 ? (
        <EmptyState
          icon="architecture"
          message={t("emptyState")}
          action={
            <Can permission="project.create">
              <Link href="/projects/new">
                <Button>
                  <Icon name="add" size={18} />
                  {t("newButton")}
                </Button>
              </Link>
            </Can>
          }
        />
      ) : (
        <div className={PROJECT_CARD_GRID}>
          {projects.map((project) => (
            <ProjectCard key={project.id} project={project} />
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
