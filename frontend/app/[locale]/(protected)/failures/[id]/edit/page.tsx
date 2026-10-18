"use client";

import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { useState } from "react";

import { FailureEditor } from "@/components/engineering/FailureEditor";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { DetailMessage } from "@/components/ui/DetailMessage";
import { Icon } from "@/components/ui/Icon";
import { Link, useRouter } from "@/i18n/navigation";
import { getFailure } from "@/lib/api/engineering";
import { useHasPermission } from "@/lib/auth/permissions";
import { useResource } from "@/lib/useResource";

export default function EditFailurePage() {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations("engineering.failure");
  const modalT = useTranslations("modal");
  const commonT = useTranslations("common");
  const router = useRouter();
  const canUpdate = useHasPermission("failure.update");

  const { data: failure, notFound } = useResource(id, getFailure);
  const [isDirty, setIsDirty] = useState(false);
  const [confirmLeaveOpen, setConfirmLeaveOpen] = useState(false);

  if (notFound) {
    return <DetailMessage error>{t("notFound")}</DetailMessage>;
  }
  if (!failure) {
    return <DetailMessage>{t("loading")}</DetailMessage>;
  }
  if (!canUpdate) {
    return <p className="font-body-md text-body-md text-on-surface-variant">{t("editPermissionRequired")}</p>;
  }

  const backHref = `/failures/${failure.id}`;

  return (
    <div className="max-w-[800px] mx-auto space-y-4">
      <Link
        href={backHref}
        onClick={(e) => {
          if (!isDirty) return;
          e.preventDefault();
          setConfirmLeaveOpen(true);
        }}
        className="inline-flex items-center gap-1 font-label-caps text-label-caps uppercase text-on-surface-variant hover:text-on-surface transition-colors"
      >
        <Icon name="arrow_back" size={16} />
        {t("backToFailure")}
      </Link>

      <FailureEditor failure={failure} onDirtyChange={setIsDirty} />

      <ConfirmModal
        open={confirmLeaveOpen}
        onOpenChange={setConfirmLeaveOpen}
        title={modalT("discardTitle")}
        description={modalT("discardDescription")}
        confirmLabel={commonT("discard")}
        danger
        onConfirm={() => router.push(backHref)}
      />
    </div>
  );
}
