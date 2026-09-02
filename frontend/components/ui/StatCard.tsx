import { Icon } from "./Icon";

interface StatCardProps {
  label: string;
  value: number | string;
  icon: string;
  /** Small line under the value (e.g. "12 this week") - omitted entirely when
   * there's no real data behind it, rather than shown fake (see Dashboard's
   * own comment on why Failures/Projects cards don't exist yet). */
  trend?: string;
  /** "horizontal" (default) - label+icon on one row, value below, used by the
   * Dashboard's own two top-level stat cards. "stacked" - icon, then value,
   * then label, each centered on its own line top to bottom - used by
   * ContributionsPanel's denser 9-across contribution-type grid, where a
   * horizontal label+icon row doesn't fit as many columns per row. */
  layout?: "horizontal" | "stacked";
}

export function StatCard({ label, value, icon, trend, layout = "horizontal" }: StatCardProps) {
  if (layout === "stacked") {
    return (
      <div className="bg-surface-container-low border border-outline-variant rounded-xl p-4 flex flex-col items-center text-center gap-1">
        <Icon name={icon} size={20} className="text-on-surface-variant" />
        <div className="font-display text-display text-on-surface">{value}</div>
        <span className="font-body-md text-body-md text-on-surface-variant">{label}</span>
        {trend && <div className="font-mono-sm text-mono-sm text-on-surface-variant">{trend}</div>}
      </div>
    );
  }

  return (
    <div className="bg-surface-container-low border border-outline-variant rounded-xl p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="font-body-md text-body-md text-on-surface-variant">{label}</span>
        <Icon name={icon} size={18} className="text-on-surface-variant" />
      </div>
      <div className="font-display text-display text-on-surface">{value}</div>
      {trend && <div className="font-mono-sm text-mono-sm text-on-surface-variant mt-1">{trend}</div>}
    </div>
  );
}
