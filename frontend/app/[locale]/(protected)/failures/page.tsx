"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Can } from "@/components/auth/Can";
import { FailuresTable } from "@/components/engineering/FailuresTable";
import { ActiveFilterChip } from "@/components/ui/ActiveFilterChip";
import { Button } from "@/components/ui/Button";
import { Combobox } from "@/components/ui/Combobox";
import { Icon } from "@/components/ui/Icon";
import { Pagination } from "@/components/ui/Pagination";
import { Link } from "@/i18n/navigation";
import { getFailures, type FailureOrdering } from "@/lib/api/engineering";
import type { FailureSeverity, FailureStatus, FailureSummary } from "@/lib/api/types";
import { useEngineeringListFiltersEnabled } from "@/lib/auth/permissions";
import { FAILURE_SEVERITY_ICONS, FAILURE_STATUS_ICONS } from "@/lib/optionIcons";

const SEVERITY_VALUES: FailureSeverity[] = ["LOW", "MEDIUM", "HIGH"];
const STATUS_VALUES: FailureStatus[] = ["UNDER_INVESTIGATION", "RESOLVED"];

export default function FailuresPage() {
  const t = useTranslations("engineering.failure");
  const severityT = useTranslations("engineering.failureSeverity");
  const statusT = useTranslations("engineering.failureStatus");
  const commonT = useTranslations("common");

  const filtersEnabled = useEngineeringListFiltersEnabled();
  const [severityFilter, setSeverityFilter] = useState<FailureSeverity | null>(null);
  const [statusFilter, setStatusFilter] = useState<FailureStatus | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [ordering, setOrdering] = useState<FailureOrdering | undefined>(undefined);
  useEffect(() => {
    const handle = setTimeout(() => {
      setQuery(searchInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(handle);
  }, [searchInput]);

  // Keyed by the filter+page combination it was fetched for - see projects/page.tsx's
  // matching comment for why this avoids a plain setFailures(null) reset.
  const filterKey = `${severityFilter ?? ""}:${statusFilter ?? ""}:${query}:${page}:${ordering ?? ""}`;
  const [result, setResult] = useState<{
    key: string;
    failures: FailureSummary[];
    hasNext: boolean;
    count: number;
  } | null>(null);
  const failures = result?.key === filterKey ? result.failures : null;
  // Same keyed-by-filterKey pattern as `result` above, so a stale error from
  // a previous filter combination doesn't linger once you change filters.
  const [errorResult, setErrorResult] = useState<{ key: string; message: string } | null>(null);
  const error = errorResult?.key === filterKey ? errorResult.message : null;

  useEffect(() => {
    getFailures({
      severity: severityFilter ?? undefined,
      status: statusFilter ?? undefined,
      q: query || undefined,
      page,
      ordering,
    }).then(
      (data) => setResult({ key: filterKey, failures: data.results, hasNext: data.next !== null, count: data.count }),
      (err) => setErrorResult({ key: filterKey, message: err instanceof Error ? err.message : String(err) }),
    );
  }, [severityFilter, statusFilter, query, page, filterKey, ordering]);

  function updateSeverityFilter(value: FailureSeverity | null) {
    setSeverityFilter(value);
    setPage(1);
  }

  function updateStatusFilter(value: FailureStatus | null) {
    setStatusFilter(value);
    setPage(1);
  }

  function updateOrdering(value: FailureOrdering) {
    setOrdering(value);
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
              placeholder={severityT("all")}
              options={[
                { value: "", label: severityT("all") },
                ...SEVERITY_VALUES.map((value) => ({ value, label: severityT(value), ...FAILURE_SEVERITY_ICONS[value] })),
              ]}
              value={severityFilter ?? ""}
              onChange={(value) => updateSeverityFilter((value || null) as FailureSeverity | null)}
            />
          </div>
          <div className="w-48">
            <Combobox
              placeholder={statusT("all")}
              options={[
                { value: "", label: statusT("all") },
                ...STATUS_VALUES.map((value) => ({ value, label: statusT(value), ...FAILURE_STATUS_ICONS[value] })),
              ]}
              value={statusFilter ?? ""}
              onChange={(value) => updateStatusFilter((value || null) as FailureStatus | null)}
            />
          </div>
          <Can permission="failure.create">
            <Link href="/failures/new">
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
      ) : failures === null ? (
        <p className="font-body-md text-body-md text-on-surface-variant">{commonT("loading")}</p>
      ) : failures.length === 0 ? (
        <p className="font-body-md text-body-md text-on-surface-variant">{t("emptyState")}</p>
      ) : (
        <FailuresTable failures={failures} ordering={ordering} onOrderingChange={updateOrdering} />
      )}

      {failures && failures.length > 0 && (
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
