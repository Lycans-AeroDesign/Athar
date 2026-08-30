"use client";

import { useTranslations } from "next-intl";

import { Button } from "./Button";

interface PaginationProps {
  page: number;
  hasNext: boolean;
  hasPrevious: boolean;
  onPageChange: (page: number) => void;
  /** Shown alongside Prev/Next when known (e.g. "1,204 results" from a paginated envelope's count). */
  totalCount?: number;
}

// Simple Prev/Next + page number - for read-only paged browsing (Audit Log,
// Search Results). Admin screens with local staged edits (Roles, Categories)
// use an accumulating "load more" pattern instead, not this - see
// lib/hooks/useLoadMoreList.ts.
export function Pagination({ page, hasNext, hasPrevious, onPageChange, totalCount }: PaginationProps) {
  const t = useTranslations("common");

  return (
    <div className="flex items-center justify-between gap-4">
      {totalCount !== undefined && (
        <span className="font-mono-sm text-mono-sm text-on-surface-variant">
          {t("resultCount", { count: totalCount })}
        </span>
      )}
      <div className="flex items-center gap-2 ms-auto">
        <Button variant="secondary" onClick={() => onPageChange(page - 1)} disabled={!hasPrevious}>
          {t("previous")}
        </Button>
        <span className="font-mono-sm text-mono-sm text-on-surface-variant px-2">{page}</span>
        <Button variant="secondary" onClick={() => onPageChange(page + 1)} disabled={!hasNext}>
          {t("next")}
        </Button>
      </div>
    </div>
  );
}
