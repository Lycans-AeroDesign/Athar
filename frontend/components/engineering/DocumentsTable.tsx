"use client";

import { useTranslations } from "next-intl";

import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { Icon } from "@/components/ui/Icon";
import { Link } from "@/i18n/navigation";
import type { DocumentOrdering } from "@/lib/api/documents";
import type { DocumentSummary } from "@/lib/api/types";

interface DocumentsTableProps {
  documents: DocumentSummary[];
  ordering: DocumentOrdering | undefined;
  onOrderingChange: (ordering: DocumentOrdering) => void;
}

// Column set/formatting matches the plain <table> this replaced 1:1 - see
// backend/knowledge/views.py's DOCUMENT_ORDERING_FIELDS for the field names
// this must stay in sync with.
export function DocumentsTable({ documents, ordering, onOrderingChange }: DocumentsTableProps) {
  const t = useTranslations("engineering.document");
  const docTypeT = useTranslations("engineering.documentType");
  const sourceT = useTranslations("engineering.documentSource");

  const columns: DataTableColumn<DocumentSummary>[] = [
    {
      field: "title",
      labelKey: "colTitle",
      render: (doc) => (
        <Link
          href={`/documents/${doc.id}`}
          className="flex items-center gap-1.5 font-body-md text-body-md text-primary hover:underline"
        >
          {doc.visibility === "RESTRICTED" && <Icon name="lock" size={14} className="text-error shrink-0" />}
          {doc.title}
        </Link>
      ),
    },
    {
      field: "doc_type",
      labelKey: "colType",
      render: (doc) => <span className="font-body-md text-body-md text-on-surface-variant">{docTypeT(doc.doc_type)}</span>,
    },
    {
      field: "source",
      labelKey: "colSource",
      render: (doc) => <span className="font-body-md text-body-md text-on-surface-variant">{sourceT(doc.source)}</span>,
    },
    {
      field: "category",
      labelKey: "colCategory",
      render: (doc) => (
        <span className="font-body-md text-body-md text-on-surface-variant">{doc.category?.name ?? "—"}</span>
      ),
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={documents}
      t={t}
      ordering={ordering}
      onOrderingChange={(value) => onOrderingChange(value as DocumentOrdering)}
    />
  );
}
