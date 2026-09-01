"use client";

import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { TestEditor } from "@/components/engineering/TestEditor";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Icon } from "@/components/ui/Icon";
import { Link, useRouter } from "@/i18n/navigation";
import { getTest } from "@/lib/api/engineering";
import type { TestDetail } from "@/lib/api/types";
import { useHasPermission } from "@/lib/auth/permissions";

export default function EditTestPage() {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations("engineering.test");
  const modalT = useTranslations("modal");
  const commonT = useTranslations("common");
  const router = useRouter();
  const canUpdate = useHasPermission("test.update");

  const [test, setTest] = useState<TestDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [confirmLeaveOpen, setConfirmLeaveOpen] = useState(false);

  useEffect(() => {
    getTest(id).then(setTest, () => setNotFound(true));
  }, [id]);

  if (notFound) {
    return <p className="font-body-md text-body-md text-error">{t("notFound")}</p>;
  }
  if (!test) {
    return <p className="font-body-md text-body-md text-on-surface-variant">{t("loading")}</p>;
  }
  if (!canUpdate) {
    return <p className="font-body-md text-body-md text-on-surface-variant">{t("editPermissionRequired")}</p>;
  }

  const backHref = `/tests/${test.id}`;

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
        {t("backToTest")}
      </Link>

      <TestEditor test={test} onDirtyChange={setIsDirty} />

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
