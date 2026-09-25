"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Can } from "@/components/auth/Can";
import { TestsTable } from "@/components/engineering/TestsTable";
import { ActiveFilterChip } from "@/components/ui/ActiveFilterChip";
import { Button } from "@/components/ui/Button";
import { Combobox } from "@/components/ui/Combobox";
import { Icon } from "@/components/ui/Icon";
import { Pagination } from "@/components/ui/Pagination";
import { Link } from "@/i18n/navigation";
import { getTests, type TestOrdering } from "@/lib/api/engineering";
import type { TestPassFail, TestRunStatus, TestSummary, TestType } from "@/lib/api/types";
import { useEngineeringListFiltersEnabled } from "@/lib/auth/permissions";
import { TEST_PASS_FAIL_ICONS, TEST_STATUS_ICONS, TEST_TYPE_ICONS } from "@/lib/optionIcons";

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
  const [ordering, setOrdering] = useState<TestOrdering | undefined>(undefined);
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
  const filterKey = `${typeFilter ?? ""}:${statusFilter ?? ""}:${passFailFilter ?? ""}:${query}:${page}:${ordering ?? ""}`;
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
      ordering,
    }).then(
      (data) => setResult({ key: filterKey, tests: data.results, hasNext: data.next !== null, count: data.count }),
      (err) => setErrorResult({ key: filterKey, message: err instanceof Error ? err.message : String(err) }),
    );
  }, [typeFilter, statusFilter, passFailFilter, query, page, filterKey, ordering]);

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

  function updateOrdering(value: TestOrdering) {
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
              placeholder={typeT("all")}
              options={[
                { value: "", label: typeT("all") },
                ...TYPE_VALUES.map((value) => ({ value, label: typeT(value), ...TEST_TYPE_ICONS[value] })),
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
                ...STATUS_VALUES.map((value) => ({ value, label: statusT(value), ...TEST_STATUS_ICONS[value] })),
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
                ...PASS_FAIL_VALUES.map((value) => ({ value, label: passFailT(value), ...TEST_PASS_FAIL_ICONS[value] })),
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
        <TestsTable tests={tests} ordering={ordering} onOrderingChange={updateOrdering} />
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
