"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { Icon } from "@/components/ui/Icon";
import { formatDateTime, formatRelativeTime } from "@/lib/datetime";

/** "Updated 2 hours ago" header marker for every content detail page.
 * On hover the shown text flips to the exact timestamp (no tooltip) -
 * the glanceable relative form by default, the precise date while
 * scrutinizing. Muted mono styling matches the metadata rows it appears
 * in so it never competes with the colored status pills beside it. */
export function UpdatedBadge({ updatedAt, className = "" }: { updatedAt: string; className?: string }) {
  const t = useTranslations("common");
  const [hovered, setHovered] = useState(false);

  return (
    <span
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={`inline-flex items-center gap-1 whitespace-nowrap font-mono-sm text-mono-sm text-on-surface-variant ${className}`}
    >
      <Icon name="update" size={14} />
      {hovered ? formatDateTime(updatedAt) : t("updatedAgo", { time: formatRelativeTime(updatedAt) })}
    </span>
  );
}
