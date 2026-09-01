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
import { getFailures } from "@/lib/api/engineering";
import type { FailureSeverity, FailureStatus, FailureSummary } from "@/lib/api/types";
import { useEngineeringListFiltersEnabled } from "@/lib/auth/permissions";

const SEVERITY_VALUES: FailureSeverity[] = ["LOW", "MEDIUM", "HIGH"];
const STATUS_VALUES: FailureStatus[] = ["UNDER_INVESTIGATION", "RESOLVED"];

// `failure.date` is a plain "YYYY-MM-DD" calendar date (Django DateField),
// not a UTC timestamp - lib/datetime.ts's formatDate() is deliberately for
// timestamps only (its own top comment says so), since parsing "YYYY-MM-DD"
// as a UTC instant and reformatting in the viewer's local zone can roll the
// date back a day. Format it as a calendar date instead - no timezone math.
function formatCalendarDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(year, month - 1, day));
}

const SEVERITY_CLASSES: Record<FailureSeverity, string> = {
  LOW: "bg-surface-variant text-on-surface-variant",
  MEDIUM: "bg-tertiary-container text-on-tertiary-container",
  HIGH: "bg-error-container text-on-error-container",
};

const STATUS_CLASSES: Record<FailureStatus, string> = {
  UNDER_INVESTIGATION: "border border-outline-variant text-on-surface-variant",
  RESOLVED: "bg-secondary-container text-on-secondary-container",
};

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
  useEffect(() => {
    const handle = setTimeout(() => {
      setQuery(searchInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(handle);
  }, [searchInput]);

  // Keyed by the filter+page combination it was fetched for - see projects/page.tsx's
  // matching comment for why this avoids a plain setFailures(null) reset.
  const filterKey = `${severityFilter ?? ""}:${statusFilter ?? ""}:${query}:${page}`;
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
    }).then(
      (data) => setResult({ key: filterKey, failures: data.results, hasNext: data.next !== null, count: data.count }),
      (err) => setErrorResult({ key: filterKey, message: err instanceof Error ? err.message : String(err) }),
    );
  }, [severityFilter, statusFilter, query, page, filterKey]);

  function updateSeverityFilter(value: FailureSeverity | null) {
    setSeverityFilter(value);
    setPage(1);
  }

  function updateStatusFilter(value: FailureStatus | null) {
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
              placeholder={severityT("all")}
              options={[
                { value: "", label: severityT("all") },
                ...SEVERITY_VALUES.map((value) => ({ value, label: severityT(value) })),
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
                ...STATUS_VALUES.map((value) => ({ value, label: statusT(value) })),
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
        <div className="bg-surface-container-lowest border border-outline-variant rounded-xl overflow-x-auto">
          <table className="w-full text-start border-collapse">
            <thead>
              <tr className="border-b border-outline-variant">
                <th className="py-3 px-4 font-label-caps text-label-caps text-on-surface-variant text-start">{t("colTitle")}</th>
                <th className="py-3 px-4 font-label-caps text-label-caps text-on-surface-variant text-start">{t("colComponent")}</th>
                <th className="py-3 px-4 font-label-caps text-label-caps text-on-surface-variant text-start">{t("colSeverity")}</th>
                <th className="py-3 px-4 font-label-caps text-label-caps text-on-surface-variant text-start">{t("colDate")}</th>
                <th className="py-3 px-4 font-label-caps text-label-caps text-on-surface-variant text-start">{t("colStatus")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant">
              {failures.map((failure) => (
                <tr key={failure.id} className="hover:bg-surface-container-low transition-colors">
                  <td className="py-3 px-4">
                    <Link href={`/failures/${failure.id}`} className="font-body-md text-body-md text-primary hover:underline">
                      {failure.title}
                    </Link>
                  </td>
                  <td className="py-3 px-4 font-body-md text-body-md text-on-surface-variant">
                    {failure.component?.name ?? "—"}
                  </td>
                  <td className="py-3 px-4">
                    <span
                      className={`inline-flex items-center px-2 py-1 rounded-full font-label-caps text-label-caps uppercase ${SEVERITY_CLASSES[failure.severity]}`}
                    >
                      {severityT(failure.severity)}
                    </span>
                  </td>
                  <td className="py-3 px-4 font-mono-sm text-mono-sm text-on-surface-variant">
                    {failure.date ? formatCalendarDate(failure.date) : "—"}
                  </td>
                  <td className="py-3 px-4">
                    <span
                      className={`inline-flex items-center px-2 py-1 rounded-full font-label-caps text-label-caps uppercase ${STATUS_CLASSES[failure.status]}`}
                    >
                      {statusT(failure.status)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
