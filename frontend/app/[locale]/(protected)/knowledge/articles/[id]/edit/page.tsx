"use client";

import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { useState } from "react";

import { ArticleEditor } from "@/components/knowledge/ArticleEditor";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { DetailMessage } from "@/components/ui/DetailMessage";
import { Icon } from "@/components/ui/Icon";
import { EditorPageSkeleton } from "@/components/ui/Skeleton";
import { Link, useRouter } from "@/i18n/navigation";
import { getArticle } from "@/lib/api/knowledge";
import { useAuth } from "@/lib/auth/AuthProvider";
import { useHasPermission } from "@/lib/auth/permissions";
import { useResource } from "@/lib/useResource";

export default function EditArticlePage() {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations("knowledge.article");
  const modalT = useTranslations("modal");
  const commonT = useTranslations("common");
  const { user } = useAuth();
  const router = useRouter();
  const canUpdateAny = useHasPermission("article.update");

  const { data: article, notFound } = useResource(id, getArticle);
  const [isDirty, setIsDirty] = useState(false);
  const [confirmLeaveOpen, setConfirmLeaveOpen] = useState(false);

  if (notFound) {
    return <DetailMessage error>{t("notFound")}</DetailMessage>;
  }
  if (!article) {
    return <EditorPageSkeleton />;
  }

  const canEdit =
    user?.id === article.author?.id ||
    article.co_authors.some((coAuthor) => coAuthor.id === user?.id) ||
    canUpdateAny;
  if (!canEdit) {
    return <p className="font-body-md text-body-md text-on-surface-variant">{t("editPermissionRequired")}</p>;
  }
  // Matches update_article()'s own check in backend/knowledge/services.py -
  // archived is frozen for everyone, so getting here directly (a bookmarked
  // link, browser back, ...) shouldn't offer a form that would just 400 on save.
  if (article.status === "ARCHIVED") {
    return <p className="font-body-md text-body-md text-on-surface-variant">{t("editArchivedBlocked")}</p>;
  }

  const backHref = `/knowledge/articles/${article.id}`;

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
        {t("backToArticle")}
      </Link>

      <ArticleEditor article={article} onDirtyChange={setIsDirty} />

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
