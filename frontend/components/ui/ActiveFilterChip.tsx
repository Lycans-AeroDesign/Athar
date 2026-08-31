"use client";

import { useTranslations } from "next-intl";

import { Icon } from "./Icon";

interface ActiveFilterChipProps {
  /** The filter's current value, shown as-is (e.g. the search text) - no i18n needed for that part. */
  label: string;
  onClear: () => void;
}

// A "stamp" showing a filter is active beyond what's visible in the input
// itself (e.g. after navigating back to a list page) - same pill shape as
// RelatedContent.tsx's relation chips, just with a clear (x) action instead
// of a link.
export function ActiveFilterChip({ label, onClear }: ActiveFilterChipProps) {
  const commonT = useTranslations("common");

  return (
    <span className="inline-flex items-center gap-1.5 bg-primary/10 border border-primary/20 text-primary rounded-full ps-3 pe-1.5 py-1">
      <span className="font-body-md text-body-md">{label}</span>
      <button
        type="button"
        onClick={onClear}
        aria-label={commonT("removeFilter")}
        className="rounded-full p-0.5 hover:bg-primary/20 transition-colors"
      >
        <Icon name="close" size={14} />
      </button>
    </span>
  );
}
