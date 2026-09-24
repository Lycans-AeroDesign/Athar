"use client";

import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { Attachments } from "@/components/knowledge/Attachments";
import { ContributorsRow } from "@/components/knowledge/Contributors";
import { RelatedContent } from "@/components/knowledge/RelatedContent";
import { StatusPill } from "@/components/knowledge/StatusPill";
import { Avatar } from "@/components/ui/Avatar";
import { BookmarkButton } from "@/components/ui/BookmarkButton";
import { Button } from "@/components/ui/Button";
import { CategoryBadge } from "@/components/ui/CategoryBadge";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Icon } from "@/components/ui/Icon";
import { IconButton } from "@/components/ui/IconButton";
import { Markdown } from "@/components/ui/Markdown";
import { Modal } from "@/components/ui/Modal";
import { ShareButton } from "@/components/ui/ShareButton";
import { TagChip } from "@/components/ui/TagChip";
import { Link, useRouter } from "@/i18n/navigation";
import { formatDateTime } from "@/lib/datetime";
import { formatPersonName } from "@/lib/format";
import {
  archiveArticle,
  deleteArticle,
  getArticle,
  getArticleRevisions,
  publishArticle,
  rejectArticle,
  submitArticle,
  unarchiveArticle,
} from "@/lib/api/knowledge";
import type { ArticleDetail, ArticleRevision } from "@/lib/api/types";
import { useAuth } from "@/lib/auth/AuthProvider";
import { useHasPermission } from "@/lib/auth/permissions";
import { extractHeadings } from "@/lib/toc";

export default function ArticleDetailPage() {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations("knowledge.article");
  const { user } = useAuth();
  const router = useRouter();
  const canUpdateAny = useHasPermission("article.update");
  const canDeleteAny = useHasPermission("article.delete");
  const canPublish = useHasPermission("article.publish");
  const canReview = useHasPermission("article.review");
  const canArchive = useHasPermission("article.archive");

  const [article, setArticle] = useState<ArticleDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [revisions, setRevisions] = useState<ArticleRevision[] | null>(null);
  const [isWorking, setIsWorking] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    getArticle(id).then(setArticle, () => setNotFound(true));
  }, [id]);

  useEffect(() => {
    if (!article) return;
    getArticleRevisions(article.id)
      .then(setRevisions)
      .catch((err) => setActionError(err instanceof Error ? err.message : String(err)));
    // Only the article's id matters here - re-running this on every setArticle()
    // from the action handlers below would refetch revisions that haven't changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [article?.id]);

  const headings = useMemo(() => (article ? extractHeadings(article.content) : []), [article]);

  if (notFound) {
    return <p className="font-body-md text-body-md text-error">{t("notFound")}</p>;
  }
  if (!article) {
    return <p className="font-body-md text-body-md text-on-surface-variant">{t("loading")}</p>;
  }

  const isAuthor = user?.id === article.author?.id;
  const canEdit = isAuthor || canUpdateAny;
  // Archived is frozen even for someone who otherwise holds a blanket
  // article.update override - see update_article()'s own matching check in
  // backend/knowledge/services.py. Only gates the edit-content action; the
  // Attachments/RelatedContent sections below keep using canEdit as-is,
  // since the backend doesn't restrict those by status (yet).
  const canEditContent = canEdit && article.status !== "ARCHIVED";
  const canDelete = (isAuthor && article.status === "DRAFT") || canDeleteAny;
  const canSubmit = isAuthor && (article.status === "DRAFT" || article.status === "REJECTED");
  const canPublishNow = canPublish && (article.status === "DRAFT" || article.status === "IN_REVIEW");
  const canRejectNow = canReview && article.status === "IN_REVIEW";
  const canArchiveNow = canArchive && article.status === "PUBLISHED";
  const canUnarchiveNow = canArchive && article.status === "ARCHIVED";
  const authorName = formatPersonName(article.author);
  const docId = `ART-${article.id.slice(0, 8).toUpperCase()}`;

  async function handleSubmit() {
    setIsWorking(true);
    setActionError(null);
    try {
      setArticle(await submitArticle(article!.id));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsWorking(false);
    }
  }

  async function handlePublish() {
    setIsWorking(true);
    setActionError(null);
    try {
      setArticle(await publishArticle(article!.id));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsWorking(false);
    }
  }

  async function handleReject() {
    setActionError(null);
    try {
      setArticle(await rejectArticle(article!.id, rejectReason.trim()));
      setRejectReason("");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleArchive() {
    setActionError(null);
    try {
      setArticle(await archiveArticle(article!.id));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleUnarchive() {
    setIsWorking(true);
    setActionError(null);
    try {
      setArticle(await unarchiveArticle(article!.id));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsWorking(false);
    }
  }

  async function handleDelete() {
    setActionError(null);
    try {
      await deleteArticle(article!.id);
      router.push("/knowledge");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="flex flex-col lg:flex-row gap-8 items-start">
      {headings.length > 0 && (
        <aside className="hidden lg:block w-56 shrink-0 sticky top-6">
          <h3 className="font-label-caps text-label-caps text-on-surface-variant uppercase tracking-wider mb-3">
            {t("tableOfContents")}
          </h3>
          <ul className="space-y-2 font-body-md text-body-md border-s border-outline-variant">
            {headings.map((heading) => (
              <li key={heading.slug} className={heading.level === 3 ? "ps-6" : "ps-3"}>
                <a href={`#${heading.slug}`} className="text-on-surface-variant hover:text-primary transition-colors">
                  {heading.text}
                </a>
              </li>
            ))}
          </ul>
        </aside>
      )}

      <div className="flex-1 w-full min-w-0 max-w-[800px] space-y-6">
        <Link
          href="/knowledge"
          className="inline-flex items-center gap-1 font-label-caps text-label-caps uppercase text-on-surface-variant hover:text-on-surface transition-colors"
        >
          <Icon name="arrow_back" size={16} />
          {t("backToKnowledge")}
        </Link>

        <div className="border-t-4 border-primary rounded-t-xl bg-surface pt-6 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="flex items-center gap-1 font-label-caps text-label-caps uppercase text-primary">
                <Icon name="menu_book" size={14} />
                {t("badgeLabel")}
              </span>
              <span className="font-mono-sm text-mono-sm text-on-surface-variant">{docId}</span>
            </div>
            <div className="flex items-center gap-2">
              <BookmarkButton key={article.id} type="article" objectId={article.id} bookmarkId={article.bookmark_id} />
              <ShareButton title={article.title} />
              {canEditContent && (
                <Link href={`/knowledge/articles/${article.id}/edit`}>
                  <IconButton icon="edit" variant="secondary" aria-label={t("editButton")} />
                </Link>
              )}
              {canArchiveNow && (
                <IconButton
                  icon="archive"
                  variant="secondary"
                  aria-label={t("archiveButton")}
                  disabled={isWorking}
                  onClick={() => setArchiveOpen(true)}
                />
              )}
              {canDelete && (
                <IconButton
                  icon="delete"
                  variant="danger"
                  aria-label={t("deleteButton")}
                  onClick={() => setDeleteOpen(true)}
                />
              )}
            </div>
          </div>
          <h1 className="font-display text-display text-on-surface">{article.title}</h1>
          {/* Tier 1: status + category - the two things worth a glance,
              both solid/colored pills. Tier 2 (tags) gets its own lighter
              row below instead of sharing this one, so a single category
              doesn't read as just another tag in a flat list. */}
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={article.status} />
            {article.category && <CategoryBadge name={article.category.name} />}
          </div>
          <div className="flex flex-wrap items-center gap-3 font-mono-sm text-mono-sm text-on-surface-variant">
            {article.visibility === "RESTRICTED" && (
              <span className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-error-container text-on-error-container font-label-caps text-label-caps uppercase">
                <Icon name="lock" size={12} />
                {t("visibilityRESTRICTED")}
              </span>
            )}
            {authorName && article.author && (
              <Link href={`/users/${article.author.id}`} className="hover:text-primary hover:underline transition-colors">
                {t("byAuthor", { name: authorName })}
              </Link>
            )}
            <span>{formatDateTime(article.updated_at)}</span>
          </div>
          {article.tags.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {article.tags.map((tag) => (
                <TagChip key={tag.id} tag={tag} />
              ))}
            </div>
          )}
          <ContributorsRow contributors={article.contributors} />
        </div>

        {(canSubmit || canPublishNow || canRejectNow || canUnarchiveNow) && (
          <div className="flex flex-wrap items-center gap-3 pb-4 border-b border-outline-variant">
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
            {canRejectNow && (
              <Button variant="secondary" onClick={() => setRejectOpen(true)} disabled={isWorking}>
                {t("rejectButton")}
              </Button>
            )}
            {canUnarchiveNow && (
              <Button onClick={handleUnarchive} disabled={isWorking}>
                <Icon name="unarchive" size={18} />
                {t("unarchiveButton")}
              </Button>
            )}
          </div>
        )}

        {actionError && (
          <p className="font-body-md text-body-md text-error" role="alert">
            {actionError}
          </p>
        )}

        <Markdown content={article.content} />

        <Attachments type="article" id={article.id} canEdit={canEdit} />

        {revisions && revisions.length > 0 && (
          <div className="pt-6 border-t border-outline-variant space-y-4">
            <h3 className="font-headline-md text-headline-md text-on-surface">{t("historyModalTitle")}</h3>
            <div className="flex flex-col gap-3">
              {revisions.map((revision) => (
                <div
                  key={revision.id}
                  className="flex gap-3 bg-surface p-4 rounded-xl border border-outline-variant"
                >
                  {revision.edited_by ? (
                    <Link href={`/users/${revision.edited_by.id}`} className="shrink-0">
                      <Avatar person={revision.edited_by} />
                    </Link>
                  ) : (
                    <Avatar person={revision.edited_by} />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center justify-between gap-x-2 mb-1">
                      {revision.edited_by ? (
                        <Link
                          href={`/users/${revision.edited_by.id}`}
                          className="font-body-md text-body-md font-bold text-on-surface hover:text-primary hover:underline transition-colors"
                        >
                          {formatPersonName(revision.edited_by)}
                        </Link>
                      ) : (
                        <span className="font-body-md text-body-md font-bold text-on-surface">{t("systemAuthor")}</span>
                      )}
                      <span className="font-mono-sm text-mono-sm text-on-surface-variant shrink-0">
                        {formatDateTime(revision.created_at)}
                      </span>
                    </div>
                    <p className="font-body-md text-body-md text-on-surface-variant">{revision.title}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <ConfirmModal
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          title={t("deleteConfirmTitle")}
          description={t("deleteConfirmBody")}
          confirmLabel={t("deleteButton")}
          danger
          onConfirm={handleDelete}
        />

        <ConfirmModal
          open={archiveOpen}
          onOpenChange={setArchiveOpen}
          title={t("archiveConfirmTitle")}
          description={t("archiveConfirmBody")}
          confirmLabel={t("archiveButton")}
          onConfirm={handleArchive}
        />

        <Modal
          open={rejectOpen}
          onOpenChange={setRejectOpen}
          title={t("rejectModalTitle")}
          isDirty={rejectReason.length > 0}
          footer={
            <Button variant="danger" onClick={handleReject}>
              {t("rejectButton")}
            </Button>
          }
        >
          <div className="space-y-2">
            <label className="block font-label-caps text-label-caps text-on-surface-variant uppercase">
              {t("rejectReasonLabel")}
            </label>
            <textarea
              className="block w-full min-h-[100px] px-4 py-2 font-body-md text-body-md text-on-surface bg-surface-container border border-outline-variant rounded-lg focus:ring-1 focus:ring-primary focus:border-primary outline-none transition-colors"
              placeholder={t("rejectReasonPlaceholder")}
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
            />
          </div>
        </Modal>
      </div>

      <RelatedContent type="article" id={article.id} canEdit={canEdit} />
    </div>
  );
}
