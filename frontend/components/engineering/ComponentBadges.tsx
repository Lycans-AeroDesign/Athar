"use client";

import { useTranslations } from "next-intl";

import { Icon } from "@/components/ui/Icon";
import type { ComponentStatus, StockStatus } from "@/lib/api/types";
import { STOCK_STATUS_ICONS } from "@/lib/optionIcons";

// Shared by the Components grid, table and detail page - one place for the
// pill colors instead of a copy in each.

const ENGINEERING_STATUS_CLASSES: Record<ComponentStatus, string> = {
  CERTIFIED: "bg-primary-container text-on-primary-container",
  TESTING: "bg-callout-warning/15 text-callout-warning ring-1 ring-inset ring-callout-warning/40",
  DEPRECATED: "bg-error-container text-on-error-container",
};

// Not callout-warning (amber) for anything benign - it reads as a caution.
const STOCK_STATUS_CLASSES: Record<StockStatus, string> = {
  IN_STOCK: "bg-primary-container text-on-primary-container",
  LOW_STOCK: "bg-secondary-container text-on-secondary-container",
  MISSING: "bg-error-container text-on-error-container",
  ON_ORDER: "bg-surface-container-high text-on-surface",
  RETIRED: "bg-surface-container-high text-on-surface-variant",
};

const PILL = "inline-flex items-center gap-1 font-label-caps text-label-caps uppercase rounded-full px-2.5 py-1 shrink-0";

/** Renders nothing for "" - a component with no engineering status (e.g. a workshop tool). */
export function EngineeringStatusPill({ status }: { status: ComponentStatus | "" }) {
  const t = useTranslations("engineering.componentStatus");
  if (!status) return null;
  return <span className={`${PILL} ${ENGINEERING_STATUS_CLASSES[status]}`}>{t(status)}</span>;
}

/** Renders nothing for "" - a component whose inventory was never tracked. */
export function StockStatusPill({ status }: { status: StockStatus | "" }) {
  const t = useTranslations("engineering.stockStatus");
  if (!status) return null;
  return (
    <span className={`${PILL} ${STOCK_STATUS_CLASSES[status]}`}>
      <Icon name={STOCK_STATUS_ICONS[status].icon} size={12} />
      {t(status)}
    </span>
  );
}
