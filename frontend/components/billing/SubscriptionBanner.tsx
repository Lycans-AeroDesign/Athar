"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { Icon } from "@/components/ui/Icon";
import { IconButton } from "@/components/ui/IconButton";
import { Link } from "@/i18n/navigation";
import { useHasPermission } from "@/lib/auth/permissions";
import { useSubscription } from "@/lib/billing/SubscriptionProvider";
import { formatDate } from "@/lib/datetime";

// Shown above every page while the org's subscription needs attention: renewal coming up, in the
// grace period, or expired (read-only). The read-only one can't be dismissed.
export function SubscriptionBanner() {
  const t = useTranslations("billing");
  const { subscription } = useSubscription();
  const canManage = useHasPermission("organization.manage");
  const [dismissed, setDismissed] = useState(false);

  if (!subscription?.enabled || subscription.status === "exempt") return null;
  const { status, access_until, read_only_from, renewal_due } = subscription;
  const isReadOnly = subscription.read_only;
  const isUrgent = isReadOnly || status === "grace";
  if (!isUrgent && (!renewal_due || dismissed)) return null;

  const date = formatDate(access_until);
  const message = isReadOnly
    ? t("banner.readOnly")
    : status === "grace"
      ? t("banner.grace", { date, readOnlyDate: formatDate(read_only_from) })
      : status === "trialing"
        ? t("banner.trialEnding", { date })
        : t("banner.renewalDue", { date });

  return (
    <div
      role={isUrgent ? "alert" : "status"}
      className={`flex items-start gap-3 rounded-xl border px-4 py-3 font-body-md text-body-md ${
        isUrgent
          ? "border-error bg-error-container text-on-error-container"
          : "border-outline-variant bg-secondary-container text-on-secondary-container"
      }`}
    >
      <Icon name={isReadOnly ? "lock" : "schedule"} size={20} className="mt-0.5 shrink-0" />
      <p className="min-w-0 flex-1">
        {message}{" "}
        {canManage ? (
          <Link href="/settings/subscription" className="font-bold underline">
            {t("banner.manageLink")}
          </Link>
        ) : (
          t("banner.contactAdmin")
        )}
      </p>
      {!isUrgent && <IconButton icon="close" aria-label={t("banner.dismiss")} onClick={() => setDismissed(true)} />}
    </div>
  );
}
