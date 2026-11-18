"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { SubscriptionStatusBadge } from "@/components/billing/SubscriptionStatusBadge";
import { Button } from "@/components/ui/Button";
import { DatePicker } from "@/components/ui/DatePicker";
import { FloatingLabelInput } from "@/components/ui/FloatingLabelInput";
import { INPUT_CLASS } from "@/components/ui/inputStyles";
import { Modal } from "@/components/ui/Modal";
import { SkeletonText } from "@/components/ui/Skeleton";
import { Switch } from "@/components/ui/Switch";
import {
  getPlatformSettings,
  getPlatformSubscription,
  recordPlatformPayment,
  updatePlatformSubscription,
  type PlatformSubscription,
  type PlatformSubscriptionUpdate,
} from "@/lib/api/platform";
import { formatBytes } from "@/lib/bytes";
import {
  formatCalendarDate,
  formatDate,
  localDateToUtcIsoString,
  toCalendarDate,
  utcToLocalDate,
} from "@/lib/datetime";
import { errorMessage } from "@/lib/errors";

const GB = 1024 ** 3;

/** "" -> null, otherwise a non-negative whole number (or NaN, which the backend rejects). */
function parseLimit(value: string): number | null {
  return value.trim() === "" ? null : Number(value);
}

// Platform > organization: its subscription (backend/billing) - status, limits, recording an
// annual payment, manual adjustments, and payment history.
export function PlatformOrganizationSubscription({
  orgId,
  onChange,
}: {
  orgId: string;
  /** Called after any change so the page can refresh its own summary. */
  onChange?: () => void;
}) {
  const t = useTranslations("platform.billing");
  const [subscription, setSubscription] = useState<PlatformSubscription | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    getPlatformSubscription(orgId)
      .then(setSubscription)
      .catch((err) => setError(errorMessage(err)));
  }, [orgId]);

  async function apply(action: () => Promise<PlatformSubscription>): Promise<boolean> {
    setIsSaving(true);
    setError(null);
    try {
      setSubscription(await action());
      onChange?.();
      return true;
    } catch (err) {
      setError(errorMessage(err));
      return false;
    } finally {
      setIsSaving(false);
    }
  }

  if (!subscription) {
    return (
      <div className="bg-surface rounded-xl border border-outline-variant p-4 sm:p-6">
        {error ? (
          <p className="font-body-md text-body-md text-error" role="alert">
            {error}
          </p>
        ) : (
          <div role="status" aria-busy="true">
            <SkeletonText variant="headline-md" width="w-40" />
            <SkeletonText width="w-2/3" />
          </div>
        )}
      </div>
    );
  }

  const s = subscription;
  return (
    <div className="bg-surface rounded-xl border border-outline-variant p-4 sm:p-6 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-headline-md text-headline-md text-on-surface">{t("orgTitle")}</h2>
          <SubscriptionStatusBadge status={s.status} />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setEditOpen(true)}>
            {t("adjust")}
          </Button>
          <Button onClick={() => setPaymentOpen(true)}>{t("recordPayment")}</Button>
        </div>
      </div>

      {error && (
        <p className="font-body-md text-body-md text-error" role="alert">
          {error}
        </p>
      )}

      <Switch
        checked={s.exempt}
        disabled={isSaving}
        onChange={(exempt) => void apply(() => updatePlatformSubscription(orgId, { exempt }))}
        label={t("exemptLabel")}
        description={t("exemptDescription")}
      />

      <dl className="grid grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-3 font-body-md text-body-md">
        <Field label={t("trialEnds")} value={formatDate(s.trial_ends_at)} />
        <Field label={t("paidUntil")} value={formatDate(s.paid_until)} />
        <Field label={t("readOnlyFrom")} value={s.exempt ? "—" : formatDate(s.read_only_from)} />
        <Field label={t("renewalDue")} value={s.renewal_due && !s.exempt ? t("yes") : t("no")} />
        <Field
          label={t("members")}
          value={
            s.max_users != null
              ? t("usedOf", { used: s.user_count, total: s.max_users })
              : t("unlimited", { used: s.user_count })
          }
        />
        <Field
          label={t("storage")}
          value={
            s.max_storage_gb != null
              ? t("usedOf", { used: formatBytes(s.storage_bytes), total: formatBytes(s.max_storage_gb * GB) })
              : t("unlimited", { used: formatBytes(s.storage_bytes) })
          }
        />
      </dl>

      {s.notes && (
        <p className="font-body-md text-body-md text-on-surface-variant whitespace-pre-wrap break-words">{s.notes}</p>
      )}

      <div className="space-y-2">
        <h3 className="font-label-caps text-label-caps uppercase text-on-surface-variant">{t("paymentHistory")}</h3>
        {s.payments.length === 0 ? (
          <p className="font-body-md text-body-md text-on-surface-variant">{t("noPayments")}</p>
        ) : (
          <ul className="space-y-1">
            {s.payments.map((payment) => (
              <li
                key={payment.id}
                className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-lg bg-surface-container font-body-md text-body-md"
              >
                <div className="min-w-0">
                  <div className="text-on-surface">
                    {payment.amount} {payment.currency} · {formatCalendarDate(payment.paid_on)}
                    {payment.reference && <span className="text-on-surface-variant"> · {payment.reference}</span>}
                  </div>
                  {payment.notes && <div className="text-on-surface-variant break-words">{payment.notes}</div>}
                </div>
                <div className="text-on-surface-variant text-end">
                  <div>
                    {t("coversPeriod", {
                      start: formatDate(payment.period_start),
                      end: formatDate(payment.period_end),
                    })}
                  </div>
                  {payment.recorded_by_email && <div>{t("recordedBy", { email: payment.recorded_by_email })}</div>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {paymentOpen && (
        <RecordPaymentModal
          isSaving={isSaving}
          onClose={() => setPaymentOpen(false)}
          onSubmit={async (payment) => {
            if (await apply(() => recordPlatformPayment(orgId, payment))) setPaymentOpen(false);
          }}
        />
      )}
      {editOpen && (
        <AdjustModal
          subscription={s}
          isSaving={isSaving}
          onClose={() => setEditOpen(false)}
          onSubmit={async (changes) => {
            if (await apply(() => updatePlatformSubscription(orgId, changes))) setEditOpen(false);
          }}
        />
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-on-surface-variant">{label}</dt>
      <dd className="text-on-surface">{value}</dd>
    </div>
  );
}

function RecordPaymentModal({
  isSaving,
  onClose,
  onSubmit,
}: {
  isSaving: boolean;
  onClose: () => void;
  onSubmit: (payment: { amount: string; currency: string; paid_on: string; reference: string; notes: string }) => void;
}) {
  const t = useTranslations("platform.billing");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [paidOn, setPaidOn] = useState<string | null>(localDateToUtcIsoString(new Date()));
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");

  // Prefill with the instance's flat price.
  useEffect(() => {
    getPlatformSettings()
      .then((settings) => {
        setAmount((current) => current || (settings.subscription_price ?? ""));
        setCurrency(settings.subscription_currency);
      })
      .catch(() => {});
  }, []);

  const paidOnDate = utcToLocalDate(paidOn);
  const canSubmit = amount.trim() !== "" && /^[A-Za-z]{3}$/.test(currency) && paidOnDate !== null;

  return (
    <Modal
      open
      onOpenChange={(open) => !open && onClose()}
      title={t("recordPayment")}
      description={t("recordPaymentDescription")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
            disabled={!canSubmit || isSaving}
            loading={isSaving}
            onClick={() =>
              paidOnDate &&
              onSubmit({ amount: amount.trim(), currency, paid_on: toCalendarDate(paidOnDate), reference, notes })
            }
          >
            {t("recordPayment")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_8rem] gap-4">
          <FloatingLabelInput
            label={t("amount")}
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <FloatingLabelInput
            label={t("currency")}
            maxLength={3}
            value={currency}
            onChange={(e) => setCurrency(e.target.value.toUpperCase())}
          />
        </div>
        <DatePicker label={t("paidOn")} value={paidOn} onChange={setPaidOn} />
        <FloatingLabelInput
          label={t("reference")}
          maxLength={200}
          value={reference}
          onChange={(e) => setReference(e.target.value)}
        />
        <label className="block space-y-1">
          <span className="font-body-md text-body-md text-on-surface-variant">{t("notes")}</span>
          <textarea
            rows={3}
            maxLength={4000}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className={INPUT_CLASS}
          />
        </label>
      </div>
    </Modal>
  );
}

function AdjustModal({
  subscription,
  isSaving,
  onClose,
  onSubmit,
}: {
  subscription: PlatformSubscription;
  isSaving: boolean;
  onClose: () => void;
  onSubmit: (changes: PlatformSubscriptionUpdate) => void;
}) {
  const t = useTranslations("platform.billing");
  const [trialEndsAt, setTrialEndsAt] = useState(subscription.trial_ends_at);
  const [paidUntil, setPaidUntil] = useState(subscription.paid_until);
  const [maxUsers, setMaxUsers] = useState(subscription.max_users?.toString() ?? "");
  const [maxStorage, setMaxStorage] = useState(subscription.max_storage_gb?.toString() ?? "");
  const [notes, setNotes] = useState(subscription.notes);

  return (
    <Modal
      open
      onOpenChange={(open) => !open && onClose()}
      title={t("adjust")}
      description={t("adjustDescription")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
            disabled={isSaving}
            loading={isSaving}
            onClick={() =>
              onSubmit({
                trial_ends_at: trialEndsAt,
                paid_until: paidUntil,
                max_users: parseLimit(maxUsers),
                max_storage_gb: parseLimit(maxStorage),
                notes,
              })
            }
          >
            {t("save")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <DatePicker label={t("trialEnds")} value={trialEndsAt} onChange={setTrialEndsAt} />
        <DatePicker label={t("paidUntil")} value={paidUntil} onChange={setPaidUntil} />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FloatingLabelInput
            label={t("maxUsers")}
            hint={t("limitHint")}
            type="number"
            min="1"
            step="1"
            value={maxUsers}
            onChange={(e) => setMaxUsers(e.target.value)}
          />
          <FloatingLabelInput
            label={t("maxStorageGb")}
            hint={t("limitHint")}
            type="number"
            min="1"
            step="1"
            value={maxStorage}
            onChange={(e) => setMaxStorage(e.target.value)}
          />
        </div>
        <label className="block space-y-1">
          <span className="font-body-md text-body-md text-on-surface-variant">{t("notes")}</span>
          <textarea
            rows={3}
            maxLength={4000}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className={INPUT_CLASS}
          />
        </label>
      </div>
    </Modal>
  );
}
