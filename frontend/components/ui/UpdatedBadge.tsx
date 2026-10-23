import { useTranslations } from "next-intl";

import { Icon } from "@/components/ui/Icon";
import { formatDateTime, formatRelativeTime } from "@/lib/datetime";

/** "Updated 2 hours ago" header marker for every content detail page.
 * Hovering flips the visible text over to the creation date, labeled
 * "Created" so the exact timestamp isn't misread as the update time -
 * the relative line rolls up while the created line rolls in from below
 * (two stacked grid rows inside an overflow-hidden cell, CSS transition,
 * no tooltip). The grid keeps its width equal to the wider of the two
 * strings, so the flip never reflows the row. Muted mono styling matches
 * the metadata rows it appears in so it never competes with the colored
 * status pills. */
export function UpdatedBadge({
  updatedAt,
  createdAt,
  className = "",
}: {
  updatedAt: string;
  createdAt: string;
  className?: string;
}) {
  const t = useTranslations("common");
  const relative = t("updatedAgo", { time: formatRelativeTime(updatedAt) });
  const created = t("createdExactly", { time: formatDateTime(createdAt) });

  return (
    <span
      className={`group inline-flex items-center gap-1 whitespace-nowrap font-mono-sm text-mono-sm text-on-surface-variant ${className}`}
    >
      <Icon name="update" size={14} />
      <span className="relative inline-grid overflow-hidden align-baseline leading-normal">
        <span className="col-start-1 row-start-1 transition-transform duration-200 ease-out group-hover:-translate-y-[125%]">
          {relative}
        </span>
        <span
          aria-hidden="true"
          className="col-start-1 row-start-1 translate-y-[125%] transition-transform duration-200 ease-out group-hover:translate-y-0"
        >
          {created}
        </span>
      </span>
    </span>
  );
}
