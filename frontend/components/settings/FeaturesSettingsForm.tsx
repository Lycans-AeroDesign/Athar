"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";
import { ChangedIndicator } from "@/components/ui/ChangedIndicator";
import { Switch } from "@/components/ui/Switch";
import { updateGeneralSettings } from "@/lib/api/organization";
import type { OrganizationSettings } from "@/lib/api/types";

interface FeaturesSettingsFormProps {
  settings: OrganizationSettings;
  onUpdate: (settings: OrganizationSettings) => void;
  canEdit: boolean;
  onDirtyChange?: (isDirty: boolean) => void;
}

// Organization > Features - instance-wide on/off switches. Saves through the
// same General endpoint as the org name (see IdentitySettingsForm.tsx), so
// it shares organization.manage as its edit gate.
export function FeaturesSettingsForm({ settings, onUpdate, canEdit, onDirtyChange }: FeaturesSettingsFormProps) {
  const t = useTranslations("settings.general");
  const featuresT = useTranslations("settings.features");
  const commonT = useTranslations("common");
  const [productTourEnabled, setProductTourEnabled] = useState(settings.product_tour_enabled);
  const [isSaving, setIsSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const isDirty = productTourEnabled !== settings.product_tour_enabled;

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  async function handleSave() {
    setIsSaving(true);
    try {
      onUpdate(await updateGeneralSettings({ product_tour_enabled: productTourEnabled }));
      setSavedAt(Date.now());
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="max-w-2xl bg-surface rounded-xl border border-outline-variant p-6 space-y-6">
      <div>
        <h2 className="font-headline-md text-headline-md text-on-surface">{featuresT("title")}</h2>
        <p className="font-body-md text-body-md text-on-surface-variant mt-1">{featuresT("description")}</p>
      </div>

      <ChangedIndicator changed={isDirty} className="w-fit">
        <Switch
          disabled={!canEdit}
          checked={productTourEnabled}
          onChange={setProductTourEnabled}
          label={t("productTourLabel")}
          description={t("productTourDescription")}
        />
      </ChangedIndicator>

      {canEdit && (
        <div className="flex items-center gap-4">
          <Button
            variant="secondary"
            onClick={() => setProductTourEnabled(settings.product_tour_enabled)}
            disabled={!isDirty || isSaving}
          >
            {commonT("discard")}
          </Button>
          <Button onClick={handleSave} disabled={!isDirty || isSaving}>
            {isSaving ? commonT("saving") : commonT("save")}
          </Button>
          {savedAt && !isDirty && (
            <span className="font-body-md text-body-md text-on-surface-variant">{commonT("saved")}</span>
          )}
        </div>
      )}
    </div>
  );
}
