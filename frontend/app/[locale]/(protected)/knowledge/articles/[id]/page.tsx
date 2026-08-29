"use client";

import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { StatusPill } from "@/components/knowledge/StatusPill";
import { Button } from "@/components/ui/Button";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Icon } from "@/components/ui/Icon";
import { Markdown } from "@/components/ui/Markdown";
import { Link, useRouter } from "@/i18n/navigation";
import { formatDateTime } from "@/lib/datetime";
import { deleteArticle, getArticle, publishArticle, submitArticle } from "@/lib/api/knowledge";
import type { ArticleDetail } from "@/lib/api/types";
import { useAuth } from "@/lib/auth/AuthProvider";
import { useHasPermission } from "@/lib/auth/permissions";

export default function ArticleDetailPage() {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations("knowledge.article");
  const { user } = useAuth();
  const router = useRouter();
  const canUpdateAny = useHasPermission("article.update");
  const canDeleteAny = useHasPermission("article.delete");
  const canPublish = useHasPermission("article.publish");

  const [article, setArticle] = useState<ArticleDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [isWorking, setIsWorking] = useState(false);

  useEffect(() => {
    getArticle(id).then(setArticle, () => setNotFound(true));
  }, [id]);

  if (notFound) {
    return <p className="font-body-md text-body-md text-error">{t("notFound")}</p>;
  }
  if (!article) {
    return <p className="font-body-md text-body-md text-on-surface-variant">{t("loading")}</p>;
  }

  const isAuthor = user?.id === article.author?.id;
  const canEdit = isAuthor || canUpdateAny;
  const canDelete = (isAuthor && article.status === "DRAFT") || canDeleteAny;
  const canSubmit = isAuthor && article.status === "DRAFT";
  const canPublishNow = canPublish && (article.status === "DRAFT" || article.status === "IN_REVIEW");
  const authorName = article.author
    ? [article.author.first_name, article.author.last_name].filter(Boolean).join(" ") || article.author.email
    : null;

  async function handleSubmit() {
    setIsWorking(true);
    try {
      setArticle(await submitArticle(article!.id));
    } finally {
      setIsWorking(false);
    }
  }

  async function handlePublish() {
    setIsWorking(true);
    try {
      setArticle(await publishArticle(article!.id));
    } finally {
      setIsWorking(false);
    }
  }

  async function handleDelete() {
    await deleteArticle(article!.id);
    router.push("/knowledge");
  }

  return (
    <div className="max-w-[800px] mx-auto space-y-6">
      <div className="border-t-4 border-primary rounded-t-xl bg-surface pt-6 space-y-3">
        <span className="flex items-center gap-1 font-label-caps text-label-caps uppercase text-primary">
          <Icon name="menu_book" size={14} />
          {t("badgeLabel")}
        </span>
        <h1 className="font-display text-display text-on-surface">{article.title}</h1>
        <div className="flex flex-wrap items-center gap-3 font-mono-sm text-mono-sm text-on-surface-variant">
          <StatusPill status={article.status} />
          {authorName && <span>{t("byAuthor", { name: authorName })}</span>}
          <span>{formatDateTime(article.updated_at)}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {article.category && (
            <span className="font-label-caps text-label-caps uppercase border border-outline-variant rounded-full px-2.5 py-1 text-on-surface-variant">
              {article.category.name}
            </span>
          )}
          {article.tags.map((tag) => (
            <span key={tag.id} className="font-mono-sm text-mono-sm text-on-surface-variant">
              #{tag.name}
            </span>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 pb-4 border-b border-outline-variant">
        {canEdit && (
          <Link href={`/knowledge/articles/${article.id}/edit`}>
            <Button variant="secondary">{t("editButton")}</Button>
          </Link>
        )}
        {canSubmit && (
          <Button onClick={handleSubmit} disabled={isWorking}>
            {t("submitForReview")}
          </Button>
        )}
        {canPublishNow && (
          <Button onClick={handlePublish} disabled={isWorking}>
            {t("publish")}
          </Button>
        )}
        {canDelete && (
          <Button variant="danger" onClick={() => setDeleteOpen(true)}>
            {t("deleteButton")}
          </Button>
        )}
      </div>

      <Markdown content={article.content} />

      <ConfirmModal
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t("deleteConfirmTitle")}
        description={t("deleteConfirmBody")}
        confirmLabel={t("deleteButton")}
        danger
        onConfirm={handleDelete}
      />
    </div>
  );
}
