"use client";

import { useTranslations } from "next-intl";

interface SavingOverlayProps {
  open: boolean;
}

// Full-viewport blocking overlay shown while an editor's save is in flight
// (see lib/useSaveOnce.ts) - blocks every further click on the form, not
// just the save button, and stays up until the editor navigates away.
export function SavingOverlay({ open }: SavingOverlayProps) {
  const t = useTranslations("creation");
  if (!open) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 backdrop-blur-sm"
    >
      <div className="flex flex-col items-center gap-3 px-8 py-6 rounded-xl bg-surface-container-high border border-outline-variant shadow-lg">
        <span className="h-10 w-10 rounded-full border-2 border-primary/25 border-t-primary animate-spin" />
        <p className="font-label-caps text-label-caps uppercase text-on-surface">{t("savingTitle")}</p>
        <p className="font-body-sm text-body-sm text-on-surface-variant">{t("savingHint")}</p>
      </div>
    </div>
  );
}
