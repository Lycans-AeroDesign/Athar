"use client";

import { useTranslations } from "next-intl";

import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { Link } from "@/i18n/navigation";
import type { TestOrdering } from "@/lib/api/engineering";
import type { TestPassFail, TestRunStatus, TestSummary } from "@/lib/api/types";
import { formatCalendarDate } from "@/lib/format";

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

interface TestsTableProps {
  tests: TestSummary[];
  ordering: TestOrdering | undefined;
  onOrderingChange: (ordering: TestOrdering) => void;
}

// Column set/classes/formatting match the plain <table> this replaced 1:1 -
// see backend/knowledge/views.py's TEST_ORDERING_FIELDS for the field names
// this must stay in sync with. pass_fail is the one column here with a
// blank/"" sentinel value (a test not yet marked pass or fail), handled with
// a plain-text fallback rather than an empty badge.
export function TestsTable({ tests, ordering, onOrderingChange }: TestsTableProps) {
  const t = useTranslations("engineering.test");
  const typeT = useTranslations("engineering.testType");
  const statusT = useTranslations("engineering.testStatus");
  const passFailT = useTranslations("engineering.testPassFail");

  const columns: DataTableColumn<TestSummary>[] = [
    {
      field: "title",
      labelKey: "colTitle",
      render: (test) => (
        <Link href={`/tests/${test.id}`} className="font-body-md text-body-md text-primary hover:underline">
          {test.title}
        </Link>
      ),
    },
    {
      field: "test_type",
      labelKey: "colType",
      render: (test) => <span className="font-body-md text-body-md text-on-surface-variant">{typeT(test.test_type)}</span>,
    },
    {
      field: "project",
      labelKey: "colProject",
      render: (test) => (
        <span className="font-body-md text-body-md text-on-surface-variant">{test.project?.name ?? "—"}</span>
      ),
    },
    {
      field: "date",
      labelKey: "colDate",
      render: (test) => (
        <span className="font-mono-sm text-mono-sm text-on-surface-variant">
          {test.date ? formatCalendarDate(test.date) : "—"}
        </span>
      ),
    },
    {
      field: "status",
      labelKey: "colStatus",
      render: (test) => (
        <span
          className={`inline-flex items-center px-2 py-1 rounded-full font-label-caps text-label-caps uppercase ${STATUS_CLASSES[test.status]}`}
        >
          {statusT(test.status)}
        </span>
      ),
    },
    {
      field: "pass_fail",
      labelKey: "colPassFail",
      render: (test) =>
        test.pass_fail ? (
          <span
            className={`inline-flex items-center px-2 py-1 rounded-full font-label-caps text-label-caps uppercase ${PASS_FAIL_CLASSES[test.pass_fail]}`}
          >
            {passFailT(test.pass_fail)}
          </span>
        ) : (
          <span className="font-body-md text-body-md text-on-surface-variant">—</span>
        ),
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={tests}
      t={t}
      ordering={ordering}
      onOrderingChange={(value) => onOrderingChange(value as TestOrdering)}
    />
  );
}
