"use client";

import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { QuestionEditor } from "@/components/knowledge/QuestionEditor";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Icon } from "@/components/ui/Icon";
import { Link, useRouter } from "@/i18n/navigation";
import { getQuestion } from "@/lib/api/knowledge";
import type { QuestionDetail } from "@/lib/api/types";
import { useAuth } from "@/lib/auth/AuthProvider";
import { useHasPermission } from "@/lib/auth/permissions";

export default function EditQuestionPage() {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations("knowledge.question");
  const modalT = useTranslations("modal");
  const commonT = useTranslations("common");
  const router = useRouter();
  const { user } = useAuth();
  // Mirrors QuestionDetailPage's own canManage: the question's own author,
  // or question.moderate - same gate backend/knowledge/services.py's
  // update_question enforces via _require_owner_or_permission.
  const canModerate = useHasPermission("question.moderate");

  const [question, setQuestion] = useState<QuestionDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [confirmLeaveOpen, setConfirmLeaveOpen] = useState(false);

  useEffect(() => {
    getQuestion(id).then(setQuestion, () => setNotFound(true));
  }, [id]);

  if (notFound) {
    return <p className="font-body-md text-body-md text-error">{t("notFound")}</p>;
  }
  if (!question) {
    return <p className="font-body-md text-body-md text-on-surface-variant">{t("loading")}</p>;
  }

  const canEdit = user?.id === question.author?.id || canModerate;
  if (!canEdit) {
    return <p className="font-body-md text-body-md text-on-surface-variant">{t("editPermissionRequired")}</p>;
  }

  const backHref = `/knowledge/questions/${question.id}`;

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
        {t("backToQuestion")}
      </Link>

      <QuestionEditor question={question} onDirtyChange={setIsDirty} />

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
