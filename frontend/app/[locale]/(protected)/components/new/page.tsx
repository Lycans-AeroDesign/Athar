"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { ComponentEditor } from "@/components/engineering/ComponentEditor";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Icon } from "@/components/ui/Icon";
import { Link, useRouter } from "@/i18n/navigation";

export default function NewComponentPage() {
  const t = useTranslations("engineering.component");
  const modalT = useTranslations("modal");
  const commonT = useTranslations("common");
  const router = useRouter();

  const [isDirty, setIsDirty] = useState(false);
  const [confirmLeaveOpen, setConfirmLeaveOpen] = useState(false);

  return (
    <div className="max-w-[800px] mx-auto space-y-4">
      <Link
        href="/components"
        onClick={(e) => {
          if (!isDirty) return;
          e.preventDefault();
          setConfirmLeaveOpen(true);
        }}
        className="inline-flex items-center gap-1 font-label-caps text-label-caps uppercase text-on-surface-variant hover:text-on-surface transition-colors"
      >
        <Icon name="arrow_back" size={16} />
        {t("backToList")}
      </Link>

      <ComponentEditor onDirtyChange={setIsDirty} />

      <ConfirmModal
        open={confirmLeaveOpen}
        onOpenChange={setConfirmLeaveOpen}
        title={modalT("discardTitle")}
        description={modalT("discardDescription")}
        confirmLabel={commonT("discard")}
        danger
        onConfirm={() => router.push("/components")}
      />
    </div>
  );
}
