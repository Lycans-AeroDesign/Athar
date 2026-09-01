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
import { getTests } from "@/lib/api/engineering";
import type { TestPassFail, TestRunStatus, TestSummary, TestType } from "@/lib/api/types";
import { useEngineeringListFiltersEnabled } from "@/lib/auth/permissions";

const TYPE_VALUES: TestType[] = [
  "FLIGHT",
  "THRUST",
  "STRUCTURAL",
  "ELECTRICAL",
  "GROUND",
  "SOFTWARE",
  "CALIBRATION",
  "EXPERIMENT",
  "OTHER",
];
const STATUS_VALUES: TestRunStatus[] = ["PLANNED", "IN_PROGRESS", "COMPLETED"];
const PASS_FAIL_VALUES: TestPassFail[] = ["PASS", "FAIL", "PARTIAL", "NOT_APPLICABLE"];

// `test.date` is a plain "YYYY-MM-DD" calendar date (Django DateField), not
// a UTC timestamp - see failures/page.tsx's matching comment for why this
// doesn't use lib/datetime.ts's formatDate().
function formatCalendarDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(year, month - 1, day));
}

const STATUS_CLASSES: Record<TestRunStatus, string> = {
  PLANNED: "border border-outline-variant text-on-surface-variant",
  IN_PROGRESS: "bg-tertiary-container text-on-tertiary-container",
  COMPLETED: "bg-secondary-container text-on-secondary-container",
};

const PASS_FAIL_CLASSES: Record<Exclude<TestPassFail, "">, string> = {
  PASS: "bg-secondary-container text-on-secondary-container",
  FAIL: "bg-error-container text-on-error-container",
  PARTIAL: "bg-tertiary-container text-on-tertiary-container",
  NOT_APPLICABLE: "border border-outline-variant text-on-surface-variant",
};

export default function TestsPage() {
  const t = useTranslations("engineering.test");
  const typeT = useTranslations("engineering.testType");
  const statusT = useTranslations("engineering.testStatus");
  const passFailT = useTranslations("engineering.testPassFail");
  const commonT = useTranslations("common");

  const filtersEnabled = useEngineeringListFiltersEnabled();
  const [typeFilter, setTypeFilter] = useState<TestType | null>(null);
  const [statusFilter, setStatusFilter] = useState<TestRunStatus | null>(null);
  const [passFailFilter, setPassFailFilter] = useState<Exclude<TestPassFail, ""> | null>(null);
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

  // Keyed by the filter+page combination it was fetched for - see
  // failures/page.tsx's matching comment for why this avoids a plain
  // setResult(null) reset.
  const filterKey = `${typeFilter ?? ""}:${statusFilter ?? ""}:${passFailFilter ?? ""}:${query}:${page}`;
  const [result, setResult] = useState<{ key: string; tests: TestSummary[]; hasNext: boolean; count: number } | null>(
    null,
  );
  const tests = result?.key === filterKey ? result.tests : null;
  const [errorResult, setErrorResult] = useState<{ key: string; message: string } | null>(null);
  const error = errorResult?.key === filterKey ? errorResult.message : null;

  useEffect(() => {
    getTests({
      test_type: typeFilter ?? undefined,
      status: statusFilter ?? undefined,
      pass_fail: passFailFilter ?? undefined,
      q: query || undefined,
      page,
    }).then(
      (data) => setResult({ key: filterKey, tests: data.results, hasNext: data.next !== null, count: data.count }),
      (err) => setErrorResult({ key: filterKey, message: err instanceof Error ? err.message : String(err) }),
    );
  }, [typeFilter, statusFilter, passFailFilter, query, page, filterKey]);

  function updateTypeFilter(value: TestType | null) {
    setTypeFilter(value);
    setPage(1);
  }

  function updateStatusFilter(value: TestRunStatus | null) {
    setStatusFilter(value);
    setPage(1);
  }

  function updatePassFailFilter(value: Exclude<TestPassFail, ""> | null) {
    setPassFailFilter(value);
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
              placeholder={typeT("all")}
              options={[
                { value: "", label: typeT("all") },
                ...TYPE_VALUES.map((value) => ({ value, label: typeT(value) })),
              ]}
              value={typeFilter ?? ""}
              onChange={(value) => updateTypeFilter((value || null) as TestType | null)}
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
              onChange={(value) => updateStatusFilter((value || null) as TestRunStatus | null)}
            />
          </div>
          <div className="w-48">
            <Combobox
              placeholder={passFailT("all")}
              options={[
                { value: "", label: passFailT("all") },
                ...PASS_FAIL_VALUES.map((value) => ({ value, label: passFailT(value) })),
              ]}
              value={passFailFilter ?? ""}
              onChange={(value) => updatePassFailFilter((value || null) as Exclude<TestPassFail, ""> | null)}
            />
          </div>
          <Can permission="test.create">
            <Link href="/tests/new">
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
      ) : tests === null ? (
        <p className="font-body-md text-body-md text-on-surface-variant">{commonT("loading")}</p>
      ) : tests.length === 0 ? (
        <p className="font-body-md text-body-md text-on-surface-variant">{t("emptyState")}</p>
      ) : (
        <div className="bg-surface-container-lowest border border-outline-variant rounded-xl overflow-x-auto">
          <table className="w-full text-start border-collapse">
            <thead>
              <tr className="border-b border-outline-variant">
                <th className="py-3 px-4 font-label-caps text-label-caps text-on-surface-variant text-start">{t("colTitle")}</th>
                <th className="py-3 px-4 font-label-caps text-label-caps text-on-surface-variant text-start">{t("colType")}</th>
                <th className="py-3 px-4 font-label-caps text-label-caps text-on-surface-variant text-start">{t("colProject")}</th>
                <th className="py-3 px-4 font-label-caps text-label-caps text-on-surface-variant text-start">{t("colDate")}</th>
                <th className="py-3 px-4 font-label-caps text-label-caps text-on-surface-variant text-start">{t("colStatus")}</th>
                <th className="py-3 px-4 font-label-caps text-label-caps text-on-surface-variant text-start">{t("colPassFail")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant">
              {tests.map((test) => (
                <tr key={test.id} className="hover:bg-surface-container-low transition-colors">
                  <td className="py-3 px-4">
                    <Link href={`/tests/${test.id}`} className="font-body-md text-body-md text-primary hover:underline">
                      {test.title}
                    </Link>
                  </td>
                  <td className="py-3 px-4 font-body-md text-body-md text-on-surface-variant">{typeT(test.test_type)}</td>
                  <td className="py-3 px-4 font-body-md text-body-md text-on-surface-variant">
                    {test.project?.name ?? "—"}
                  </td>
                  <td className="py-3 px-4 font-mono-sm text-mono-sm text-on-surface-variant">
                    {test.date ? formatCalendarDate(test.date) : "—"}
                  </td>
                  <td className="py-3 px-4">
                    <span
                      className={`inline-flex items-center px-2 py-1 rounded-full font-label-caps text-label-caps uppercase ${STATUS_CLASSES[test.status]}`}
                    >
                      {statusT(test.status)}
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    {test.pass_fail ? (
                      <span
                        className={`inline-flex items-center px-2 py-1 rounded-full font-label-caps text-label-caps uppercase ${PASS_FAIL_CLASSES[test.pass_fail]}`}
                      >
                        {passFailT(test.pass_fail)}
                      </span>
                    ) : (
                      <span className="font-body-md text-body-md text-on-surface-variant">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tests && tests.length > 0 && (
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
