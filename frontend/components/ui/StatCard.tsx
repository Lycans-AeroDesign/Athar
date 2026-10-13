import { Icon } from "./Icon";

interface StatCardProps {
  label: string;
  value: number | string;
  icon: string;
  /** Small line under the value (e.g. "12 this week") - omitted entirely when
   * there's no real data behind it, rather than shown fake (see Dashboard's
   * own comment on why Failures/Projects cards don't exist yet). */
  trend?: string;
}

export function StatCard({ label, value, icon, trend }: StatCardProps) {
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
