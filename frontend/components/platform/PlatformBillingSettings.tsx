"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { FloatingLabelInput } from "@/components/ui/FloatingLabelInput";
import { INPUT_CLASS } from "@/components/ui/inputStyles";
import { Switch } from "@/components/ui/Switch";
import { updatePlatformSettings, type PlatformSettings } from "@/lib/api/platform";
import { errorMessage } from "@/lib/errors";

// Platform > Overview: the instance-wide subscription switch plus the flat annual price and the
// payment instructions org admins see (backend/billing).
export function PlatformBillingSettings({
  settings,
  onUpdate,
}: {
  settings: PlatformSettings;
  onUpdate: (settings: PlatformSettings) => void;
}) {
  const t = useTranslations("platform.billing");
  const [price, setPrice] = useState(settings.subscription_price ?? "");
  const [currency, setCurrency] = useState(settings.subscription_currency);
  const [instructions, setInstructions] = useState(settings.subscription_payment_instructions);
  const [confirmEnable, setConfirmEnable] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const isDirty =
    price !== (settings.subscription_price ?? "") ||
    currency !== settings.subscription_currency ||
    instructions !== settings.subscription_payment_instructions;

  async function save(changes: Partial<PlatformSettings>) {
    setIsSaving(true);
    setError(null);
    setSaved(false);
    try {
      onUpdate(await updatePlatformSettings(changes));
      return true;
    } catch (err) {
      setError(errorMessage(err));
      return false;
    } finally {
      setIsSaving(false);
    }
  }

  async function handleSaveDetails() {
    const ok = await save({
      subscription_price: price.trim() === "" ? null : price.trim(),
      subscription_currency: currency.trim().toUpperCase(),
      subscription_payment_instructions: instructions,
    });
    setSaved(ok);
  }

  return (
    <div className="bg-surface rounded-xl border border-outline-variant p-4 sm:p-6 space-y-5">
      <div>
        <h2 className="font-headline-md text-headline-md text-on-surface">{t("title")}</h2>
        <p className="font-body-md text-body-md text-on-surface-variant mt-1">{t("description")}</p>
      </div>

      <Switch
        checked={settings.subscriptions_enabled}
        disabled={isSaving}
        onChange={(enabled) => (enabled ? setConfirmEnable(true) : void save({ subscriptions_enabled: false }))}
        label={t("enabledLabel")}
        description={t("enabledDescription")}
      />

      <div className="grid grid-cols-1 sm:grid-cols-[1fr_8rem] gap-4">
        <FloatingLabelInput
          label={t("price")}
          type="number"
          min="0"
          step="0.01"
          inputMode="decimal"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
        />
        <FloatingLabelInput
          label={t("currency")}
          maxLength={3}
          value={currency}
          onChange={(e) => setCurrency(e.target.value.toUpperCase())}
        />
      </div>

      <label className="block space-y-1">
        <span className="font-body-md text-body-md text-on-surface-variant">{t("instructions")}</span>
        <textarea
          rows={4}
          maxLength={4000}
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          placeholder={t("instructionsPlaceholder")}
          className={INPUT_CLASS}
        />
      </label>

      {error && (
        <p className="font-body-md text-body-md text-error" role="alert">
          {error}
        </p>
      )}
      <div className="flex items-center justify-end gap-3">
        {saved && !isDirty && <span className="font-body-md text-body-md text-on-surface-variant">{t("saved")}</span>}
        <Button onClick={handleSaveDetails} disabled={!isDirty || isSaving} loading={isSaving}>
          {t("save")}
        </Button>
      </div>

      <ConfirmModal
        open={confirmEnable}
        onOpenChange={setConfirmEnable}
        title={t("enableTitle")}
        description={t("enableBody")}
        confirmLabel={t("enableConfirm")}
        onConfirm={async () => {
          await save({ subscriptions_enabled: true });
          setConfirmEnable(false);
        }}
      />
    </div>
  );
}
