"use client";

import { useTranslations } from "next-intl";

import { SubscriptionStatusBadge } from "@/components/billing/SubscriptionStatusBadge";
import { SkeletonText } from "@/components/ui/Skeleton";
import { useSubscription } from "@/lib/billing/SubscriptionProvider";
import { formatBytes } from "@/lib/bytes";
import { formatCalendarDate, formatDate } from "@/lib/datetime";

const GB = 1024 ** 3;

// Settings > Subscription (organization.manage, only while subscriptions are switched on): the
// org's status, renewal date, limits, how to pay, and payment history. Read-only - payments are
// recorded by the platform administrator.
export function SubscriptionSettings() {
  const t = useTranslations("billing");
  const { subscription } = useSubscription();

  if (!subscription) {
    return (
      <div
        className="max-w-3xl bg-surface rounded-xl border border-outline-variant p-4 sm:p-6"
        role="status"
        aria-busy="true"
      >
        <SkeletonText variant="headline-md" width="w-40" />
        <SkeletonText width="w-2/3" />
      </div>
    );
  }

  const s = subscription;
  const endLabel = s.status === "trialing" ? t("trialEnds") : t("accessUntil");

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="bg-surface rounded-xl border border-outline-variant p-4 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-headline-md text-headline-md text-on-surface">{t("title")}</h2>
            <p className="font-body-md text-body-md text-on-surface-variant mt-1">{t("description")}</p>
          </div>
          <SubscriptionStatusBadge status={s.status} />
        </div>

        <p className="font-body-md text-body-md text-on-surface">{t(`statusHelp.${s.status}`)}</p>

        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 font-body-md text-body-md">
          {s.access_until && <Row label={endLabel} value={formatDate(s.access_until)} />}
          {s.read_only_from && s.status !== "expired" && (
            <Row label={t("readOnlyFrom")} value={formatDate(s.read_only_from)} />
          )}
          {s.price && <Row label={t("price")} value={t("pricePerYear", { price: s.price, currency: s.currency })} />}
          <Row
            label={t("members")}
            value={s.max_users != null ? t("usedOf", { used: s.user_count, total: s.max_users }) : String(s.user_count)}
          />
          <Row
            label={t("storage")}
            value={
              s.max_storage_gb != null
                ? t("usedOf", { used: formatBytes(s.storage_bytes), total: formatBytes(s.max_storage_gb * GB) })
                : formatBytes(s.storage_bytes)
            }
          />
        </dl>
      </div>

      {s.payment_instructions && s.status !== "exempt" && (
        <div className="bg-surface rounded-xl border border-outline-variant p-4 sm:p-6 space-y-2">
          <h2 className="font-headline-md text-headline-md text-on-surface">{t("howToPay")}</h2>
          <p className="font-body-md text-body-md text-on-surface whitespace-pre-wrap break-words">
            {s.payment_instructions}
          </p>
        </div>
      )}

      <div className="bg-surface rounded-xl border border-outline-variant p-4 sm:p-6 space-y-3">
        <h2 className="font-headline-md text-headline-md text-on-surface">{t("paymentHistory")}</h2>
        {s.payments.length === 0 ? (
          <p className="font-body-md text-body-md text-on-surface-variant">{t("noPayments")}</p>
        ) : (
          <ul className="space-y-1">
            {s.payments.map((payment) => (
              <li
                key={`${payment.paid_on}-${payment.period_end}`}
                className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-lg bg-surface-container font-body-md text-body-md"
              >
                <span className="text-on-surface">
                  {payment.amount} {payment.currency} · {formatCalendarDate(payment.paid_on)}
                </span>
                <span className="text-on-surface-variant">
                  {t("coversPeriod", { start: formatDate(payment.period_start), end: formatDate(payment.period_end) })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-on-surface-variant">{label}</dt>
      <dd className="text-on-surface">{value}</dd>
    </div>
  );
}
