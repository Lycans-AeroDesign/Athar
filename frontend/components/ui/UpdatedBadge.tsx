import { useTranslations } from "next-intl";

import { Icon } from "@/components/ui/Icon";
import { formatDateTime, formatRelativeTime } from "@/lib/datetime";

/** "Updated 2 hours ago" header marker for every content detail page.
 * The relative time is the glanceable value; the exact timestamp locales over
 * in the native hover title (the codebase's tooltip convention - see
 * IconButton). Muted mono styling matches the metadata rows it appears in so
 * it never competes with the colored status pills beside it. */
export function UpdatedBadge({ updatedAt, className = "" }: { updatedAt: string; className?: string }) {
  const t = useTranslations("common");

  return (
    <span
      title={formatDateTime(updatedAt)}
      className={`inline-flex items-center gap-1 font-mono-sm text-mono-sm text-on-surface-variant ${className}`}
    >
      <Icon name="update" size={14} />
      {t("updatedAgo", { time: formatRelativeTime(updatedAt) })}
    </span>
  );
}
