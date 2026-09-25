"use client";

import { useTranslations } from "next-intl";

import { Icon } from "@/components/ui/Icon";
import type { InventorySummary, StockStatus } from "@/lib/api/types";
import { STOCK_STATUS_VALUES } from "@/lib/inventory";
import { STOCK_STATUS_ICONS } from "@/lib/optionIcons";

interface InventorySummaryPanelProps {
  summary: InventorySummary | null;
  /** The stock filter currently applied to the list, so its card reads as selected. */
  activeStatus: StockStatus | null;
  onStatusSelect: (status: StockStatus | null) => void;
}

// The workshop inventory sheet's Summary tab, live: one card per stock
// status (click to filter the list to it) and a category x status table.
// Counts follow the list's other filters (type, category, location, search)
// but not its stock filter, so every card keeps showing its own total.
export function InventorySummaryPanel({ summary, activeStatus, onStatusSelect }: InventorySummaryPanelProps) {
  const t = useTranslations("engineering.component");
  const stockT = useTranslations("engineering.stockStatus");
  const commonT = useTranslations("common");

  if (!summary) {
    return <p className="font-body-md text-body-md text-on-surface-variant">{commonT("loading")}</p>;
  }

  const categories = summary.by_category.filter((row) => row.total > 0);

  return (
    <section className="space-y-4 rounded-xl border border-outline-variant bg-surface-container-lowest p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-headline-md text-headline-md text-on-surface">{t("summaryTitle")}</h2>
        <span className="font-body-md text-body-md text-on-surface-variant">
          {t("summaryTotal", { count: summary.total })}
          {summary.by_status.UNTRACKED > 0 && ` · ${t("summaryUntracked", { count: summary.by_status.UNTRACKED })}`}
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {STOCK_STATUS_VALUES.map((status) => {
          const isActive = activeStatus === status;
          return (
            <button
              key={status}
              type="button"
              aria-pressed={isActive}
              onClick={() => onStatusSelect(isActive ? null : status)}
              className={`text-start rounded-xl border p-3 transition-colors ${
                isActive
                  ? "border-primary bg-primary-container text-on-primary-container"
                  : "border-outline-variant bg-surface-container-low hover:bg-surface-container"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-body-md text-body-md truncate">{stockT(status)}</span>
                <Icon
                  name={STOCK_STATUS_ICONS[status].icon}
                  size={16}
                  className={isActive ? undefined : STOCK_STATUS_ICONS[status].iconClassName ?? "text-on-surface-variant"}
                />
              </div>
              <div className="font-display text-display">{summary.by_status[status]}</div>
            </button>
          );
        })}
      </div>

      {categories.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-start border-collapse">
            <thead>
              <tr className="border-b border-outline-variant">
                <th className="px-3 py-2 text-start font-label-caps text-label-caps text-on-surface-variant uppercase">
                  {t("colCategory")}
                </th>
                <th className="px-3 py-2 text-end font-label-caps text-label-caps text-on-surface-variant uppercase">
                  {t("summaryTotalColumn")}
                </th>
                {STOCK_STATUS_VALUES.map((status) => (
                  <th
                    key={status}
                    className="px-3 py-2 text-end font-label-caps text-label-caps text-on-surface-variant uppercase whitespace-nowrap"
                  >
                    {stockT(status)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {categories.map((row) => (
                <tr key={row.category ?? ""} className="border-b border-outline-variant last:border-b-0">
                  <td className="px-3 py-2 font-body-md text-body-md text-on-surface">
                    {row.category ?? t("uncategorized")}
                  </td>
                  <td className="px-3 py-2 text-end font-mono-sm text-mono-sm text-on-surface">{row.total}</td>
                  {STOCK_STATUS_VALUES.map((status) => (
                    <td
                      key={status}
                      className={`px-3 py-2 text-end font-mono-sm text-mono-sm ${
                        row.by_status[status] > 0 && (status === "MISSING" || status === "LOW_STOCK")
                          ? "text-error"
                          : "text-on-surface-variant"
                      }`}
                    >
                      {row.by_status[status]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
