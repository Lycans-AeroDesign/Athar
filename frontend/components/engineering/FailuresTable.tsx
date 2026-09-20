"use client";

import { useTranslations } from "next-intl";

import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { Link } from "@/i18n/navigation";
import type { FailureOrdering } from "@/lib/api/engineering";
import type { FailureSeverity, FailureStatus, FailureSummary } from "@/lib/api/types";
import { formatCalendarDate } from "@/lib/format";

const SEVERITY_CLASSES: Record<FailureSeverity, string> = {
  LOW: "bg-surface-variant text-on-surface-variant",
  MEDIUM: "bg-tertiary-container text-on-tertiary-container",
  HIGH: "bg-error-container text-on-error-container",
};

const STATUS_CLASSES: Record<FailureStatus, string> = {
  UNDER_INVESTIGATION: "border border-outline-variant text-on-surface-variant",
  RESOLVED: "bg-secondary-container text-on-secondary-container",
};

interface FailuresTableProps {
  failures: FailureSummary[];
  ordering: FailureOrdering | undefined;
  onOrderingChange: (ordering: FailureOrdering) => void;
}

// Column set/classes/formatting match the plain <table> this replaced 1:1 -
// see backend/knowledge/views.py's FAILURE_ORDERING_FIELDS for the field
// names this must stay in sync with.
export function FailuresTable({ failures, ordering, onOrderingChange }: FailuresTableProps) {
  const t = useTranslations("engineering.failure");
  const severityT = useTranslations("engineering.failureSeverity");
  const statusT = useTranslations("engineering.failureStatus");

  const columns: DataTableColumn<FailureSummary>[] = [
    {
      field: "title",
      labelKey: "colTitle",
      render: (failure) => (
        <Link href={`/failures/${failure.id}`} className="font-body-md text-body-md text-primary hover:underline">
          {failure.title}
        </Link>
      ),
    },
    {
      field: "component",
      labelKey: "colComponent",
      render: (failure) => (
        <span className="font-body-md text-body-md text-on-surface-variant">{failure.component?.name ?? "—"}</span>
      ),
    },
    {
      field: "severity",
      labelKey: "colSeverity",
      render: (failure) => (
        <span
          className={`inline-flex items-center px-2 py-1 rounded-full font-label-caps text-label-caps uppercase ${SEVERITY_CLASSES[failure.severity]}`}
        >
          {severityT(failure.severity)}
        </span>
      ),
    },
    {
      field: "date",
      labelKey: "colDate",
      render: (failure) => (
        <span className="font-mono-sm text-mono-sm text-on-surface-variant">
          {failure.date ? formatCalendarDate(failure.date) : "—"}
        </span>
      ),
    },
    {
      field: "status",
      labelKey: "colStatus",
      render: (failure) => (
        <span
          className={`inline-flex items-center px-2 py-1 rounded-full font-label-caps text-label-caps uppercase ${STATUS_CLASSES[failure.status]}`}
        >
          {statusT(failure.status)}
        </span>
      ),
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={failures}
      t={t}
      ordering={ordering}
      onOrderingChange={(value) => onOrderingChange(value as FailureOrdering)}
    />
  );
}
