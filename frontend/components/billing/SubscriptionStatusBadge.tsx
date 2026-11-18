"use client";

import { useTranslations } from "next-intl";

import type { SubscriptionStatus } from "@/lib/api/billing";

const STYLES: Record<SubscriptionStatus, string> = {
  exempt: "bg-surface-variant text-on-surface-variant",
  trialing: "bg-secondary-container text-on-secondary-container",
  active: "bg-secondary-container text-on-secondary-container",
  grace: "bg-error-container text-on-error-container",
  expired: "bg-error text-on-error",
};

/** Pill for a subscription status (used by Settings > Subscription and the platform pages). */
export function SubscriptionStatusBadge({ status }: { status: SubscriptionStatus }) {
  const t = useTranslations("billing.status");
  return <span className={`shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 ${STYLES[status]}`}>{t(status)}</span>;
}
