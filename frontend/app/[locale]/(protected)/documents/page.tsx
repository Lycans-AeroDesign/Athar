"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Can } from "@/components/auth/Can";
import { DocumentsTable } from "@/components/engineering/DocumentsTable";
import { ActiveFilterChip } from "@/components/ui/ActiveFilterChip";
import { Button } from "@/components/ui/Button";
import { Combobox } from "@/components/ui/Combobox";
import { Icon } from "@/components/ui/Icon";
import { Pagination } from "@/components/ui/Pagination";
import { getDocuments, type DocumentOrdering } from "@/lib/api/documents";
import { Link } from "@/i18n/navigation";
import type { DocType, DocumentSource, DocumentSummary } from "@/lib/api/types";
import { useEngineeringListFiltersEnabled } from "@/lib/auth/permissions";
import { DOC_SOURCE_ICONS, DOC_TYPE_ICONS } from "@/lib/optionIcons";

const DOC_TYPE_VALUES: DocType[] = [
  "COMPETITION_REPORT",
  "TECHNICAL_REPORT",
  "RESEARCH_PAPER",
  "DATASHEET",
  "MANUAL",
  "REGULATION",
  "PRESENTATION",
  "TRAINING_MATERIAL",
  "REFERENCE",
  "OTHER",
];
const SOURCE_VALUES: DocumentSource[] = ["INTERNAL", "EXTERNAL"];

export default function DocumentsPage() {
  const t = useTranslations("engineering.document");
  const docTypeT = useTranslations("engineering.documentType");
  const sourceT = useTranslations("engineering.documentSource");
  const commonT = useTranslations("common");

  const filtersEnabled = useEngineeringListFiltersEnabled();
  const [docTypeFilter, setDocTypeFilter] = useState<DocType | null>(null);
  const [sourceFilter, setSourceFilter] = useState<DocumentSource | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [ordering, setOrdering] = useState<DocumentOrdering | undefined>(undefined);
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
  const filterKey = `${docTypeFilter ?? ""}:${sourceFilter ?? ""}:${query}:${page}:${ordering ?? ""}`;
  const [result, setResult] = useState<{
    key: string;
    documents: DocumentSummary[];
    hasNext: boolean;
    count: number;
  } | null>(null);
  const documents = result?.key === filterKey ? result.documents : null;
  const [errorResult, setErrorResult] = useState<{ key: string; message: string } | null>(null);
  const error = errorResult?.key === filterKey ? errorResult.message : null;

  useEffect(() => {
    getDocuments({
      doc_type: docTypeFilter ?? undefined,
      source: sourceFilter ?? undefined,
      q: query || undefined,
      page,
      ordering,
    }).then(
      (data) =>
        setResult({ key: filterKey, documents: data.results, hasNext: data.next !== null, count: data.count }),
      (err) => setErrorResult({ key: filterKey, message: err instanceof Error ? err.message : String(err) }),
    );
  }, [docTypeFilter, sourceFilter, query, page, filterKey, ordering]);

  function updateDocTypeFilter(value: DocType | null) {
    setDocTypeFilter(value);
    setPage(1);
  }

  function updateSourceFilter(value: DocumentSource | null) {
    setSourceFilter(value);
    setPage(1);
  }

  function updateOrdering(value: DocumentOrdering) {
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
              placeholder={docTypeT("all")}
              options={[
                { value: "", label: docTypeT("all") },
                ...DOC_TYPE_VALUES.map((value) => ({ value, label: docTypeT(value), ...DOC_TYPE_ICONS[value] })),
              ]}
              value={docTypeFilter ?? ""}
              onChange={(value) => updateDocTypeFilter((value || null) as DocType | null)}
            />
          </div>
          <div className="w-40">
            <Combobox
              placeholder={sourceT("all")}
              options={[
                { value: "", label: sourceT("all") },
                ...SOURCE_VALUES.map((value) => ({ value, label: sourceT(value), ...DOC_SOURCE_ICONS[value] })),
              ]}
              value={sourceFilter ?? ""}
              onChange={(value) => updateSourceFilter((value || null) as DocumentSource | null)}
            />
          </div>
          <Can permission="document.create">
            <Link href="/documents/new">
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
      ) : documents === null ? (
        <p className="font-body-md text-body-md text-on-surface-variant">{commonT("loading")}</p>
      ) : documents.length === 0 ? (
        <p className="font-body-md text-body-md text-on-surface-variant">{t("emptyState")}</p>
      ) : (
        <DocumentsTable documents={documents} ordering={ordering} onOrderingChange={updateOrdering} />
      )}

      {documents && documents.length > 0 && (
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
