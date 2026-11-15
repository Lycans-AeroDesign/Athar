import { Icon } from "./Icon";
import { Skeleton } from "./Skeleton";

interface StatCardProps {
  label: string;
  value: number | string | null;
  icon: string;
  /** Small line under the value (e.g. "12 this week") - omitted entirely when
   * there's no real data behind it, rather than shown fake (see Dashboard's
   * own comment on why Failures/Projects cards don't exist yet). */
  trend?: string;
  /** Extra classes for the card itself, e.g. a grid column span. */
  className?: string;
}

export function StatCard({ label, value, icon, trend, className }: StatCardProps) {
  return (
    // min-w-0 + wrapping value: a grid item otherwise refuses to shrink below its
    // content, so a long value ("12.3 GB / 100 GB") overflows a narrow mobile column.
    <div className={`min-w-0 bg-surface-container-low border border-outline-variant rounded-xl p-4 ${className ?? ""}`}>
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="min-w-0 font-body-md text-body-md text-on-surface-variant">{label}</span>
        <Icon name={icon} size={18} className="shrink-0 text-on-surface-variant" />
      </div>
      {value === null ? (
        <Skeleton className="h-9 w-16 my-0.5" />
      ) : (
        <div className="font-display text-headline-lg sm:text-display text-on-surface break-words">{value}</div>
      )}
      {trend && <div className="font-mono-sm text-mono-sm text-on-surface-variant mt-1">{trend}</div>}
    </div>
  );
}
