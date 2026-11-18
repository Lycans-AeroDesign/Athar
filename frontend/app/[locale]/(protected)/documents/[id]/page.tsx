"use client";

import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { useState } from "react";

import { ContributorsRow } from "@/components/knowledge/Contributors";
import { RelatedContent } from "@/components/knowledge/RelatedContent";
import { AuthenticatedImage } from "@/components/ui/AuthenticatedImage";
import { AuthenticatedPdfEmbed } from "@/components/ui/AuthenticatedPdfEmbed";
import { BookmarkButton } from "@/components/ui/BookmarkButton";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { DetailMessage } from "@/components/ui/DetailMessage";
import { FilePreviewModal } from "@/components/ui/FilePreviewModal";
import { Icon } from "@/components/ui/Icon";
import { IconButton } from "@/components/ui/IconButton";
import { Markdown } from "@/components/ui/Markdown";
import { DetailPageSkeleton } from "@/components/ui/Skeleton";
import { UpdatedBadge } from "@/components/ui/UpdatedBadge";
import { Link, useRouter } from "@/i18n/navigation";
import { deleteDocument, getDocument } from "@/lib/api/documents";
import { downloadFile } from "@/lib/api/files";
import { useAuth } from "@/lib/auth/AuthProvider";
import { useHasPermission } from "@/lib/auth/permissions";
import { errorMessage } from "@/lib/errors";
import { formatCalendarDate } from "@/lib/format";
import { useResource } from "@/lib/useResource";

export default function DocumentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations("engineering.document");
  const docTypeT = useTranslations("engineering.documentType");
  const sourceT = useTranslations("engineering.documentSource");
  const { user } = useAuth();
  const canUpdateAny = useHasPermission("document.update");
  const router = useRouter();

  const { data: document, notFound } = useResource(id, getDocument);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  if (notFound) {
    return <DetailMessage error>{t("notFound")}</DetailMessage>;
  }
  if (!document) {
    return <DetailPageSkeleton />;
  }

  // Ownership-or-document.update, mirroring update_document/delete_document's
  // exact gate in backend/knowledge/services.py.
  const isOwner = user?.id === document.created_by?.id;
  const canEdit = isOwner || canUpdateAny;

  async function handleDelete() {
    setActionError(null);
    try {
      await deleteDocument(document!.id);
      router.push("/documents");
    } catch (err) {
      setActionError(errorMessage(err));
    }
  }

  async function handleDownload() {
    if (!document!.file) return;
    setActionError(null);
    try {
      await downloadFile(document!.file.id, document!.file.original_filename);
    } catch (err) {
      setActionError(errorMessage(err));
    }
  }

  return (
    <div className="flex flex-col lg:flex-row gap-8 items-start">
      <div className="flex-1 w-full min-w-0 max-w-[800px] space-y-6">
        <Link
          href="/documents"
          className="inline-flex items-center gap-1 font-label-caps text-label-caps uppercase text-on-surface-variant hover:text-on-surface transition-colors"
        >
          <Icon name="arrow_back" size={16} />
          {t("backToList")}
        </Link>

        <div className="border-t-4 border-primary rounded-t-xl bg-surface pt-6 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center px-2.5 py-1 rounded-full font-label-caps text-label-caps uppercase border border-outline-variant text-on-surface-variant">
                {docTypeT(document.doc_type)}
              </span>
              <span className="inline-flex items-center px-2.5 py-1 rounded-full font-label-caps text-label-caps uppercase border border-outline-variant text-on-surface-variant">
                {sourceT(document.source)}
              </span>
              {document.visibility === "RESTRICTED" && (
                <span className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-error-container text-on-error-container font-label-caps text-label-caps uppercase">
                  <Icon name="lock" size={12} />
                  {t("visibilityRESTRICTED")}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <BookmarkButton
                key={document.id}
                type="document"
                objectId={document.id}
                bookmarkId={document.bookmark_id}
              />
              {canEdit && (
                <Link href={`/documents/${document.id}/edit`}>
                  <IconButton icon="edit" variant="secondary" aria-label={t("editButton")} />
                </Link>
              )}
              {canEdit && (
                <IconButton
                  icon="delete"
                  variant="danger"
                  aria-label={t("deleteButton")}
                  onClick={() => setDeleteOpen(true)}
                />
              )}
            </div>
          </div>
          <h1 className="font-display text-display text-on-surface">{document.title}</h1>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono-sm text-mono-sm text-on-surface-variant">
            {document.author && <span>{document.author}</span>}
            {document.organization && <span>{document.organization}</span>}
            {document.publication_date && <span>{formatCalendarDate(document.publication_date)}</span>}
            {document.category && (
              <span>
                {t("colCategory")}: {document.category.name}
              </span>
            )}
            <UpdatedBadge updatedAt={document.updated_at} createdAt={document.created_at} />
          </div>
          <ContributorsRow contributors={document.contributors} />
        </div>

        {actionError && (
          <p className="font-body-md text-body-md text-error" role="alert">
            {actionError}
          </p>
        )}

        {(document.file || document.url) && (
          <div className="flex flex-wrap items-center gap-3">
            {document.file && (
              <div className="inline-flex items-center rounded-lg bg-surface-container-low border border-outline-variant overflow-hidden">
                <button
                  type="button"
                  onClick={() => setPreviewOpen(true)}
                  className="inline-flex items-center gap-2 px-4 py-2 font-body-md text-body-md text-primary hover:bg-surface-variant transition-colors"
                >
                  <Icon name="visibility" size={16} />
                  {document.file.original_filename}
                </button>
                <button
                  type="button"
                  onClick={handleDownload}
                  aria-label={t("downloadButton")}
                  className="p-2 text-on-surface-variant hover:text-primary hover:bg-surface-variant transition-colors border-s border-outline-variant"
                >
                  <Icon name="download" size={16} />
                </button>
              </div>
            )}
            {document.url && (
              <a
                href={document.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-surface-container-low border border-outline-variant font-body-md text-body-md text-primary hover:bg-surface-variant transition-colors"
              >
                <Icon name="link" size={16} />
                {t("openLinkButton")}
              </a>
            )}
          </div>
        )}

        {/* PDFs and images show inline so the document can be read without
          opening the preview; the filename chip above still opens it full size. */}
        {document.file?.content_type === "application/pdf" && (
          <div className="w-full h-[75vh] rounded-xl overflow-hidden border border-outline-variant bg-surface-container-high">
            <AuthenticatedPdfEmbed
              src={document.file.download_url}
              title={document.file.original_filename}
              className="h-full w-full"
            />
          </div>
        )}
        {document.file?.content_type.startsWith("image/") && (
          <button
            type="button"
            onClick={() => setPreviewOpen(true)}
            aria-label={document.file.original_filename}
            className="block w-full rounded-xl overflow-hidden border border-outline-variant bg-surface-container-high"
          >
            <AuthenticatedImage
              src={document.file.download_url}
              alt={document.file.original_filename}
              className="w-full max-h-[75vh] object-contain"
            />
          </button>
        )}

        {document.description && (
          <section>
            <h2 className="font-headline-md text-headline-md text-on-surface mb-2 border-b border-outline-variant pb-1">
              {t("descriptionLabel")}
            </h2>
            <Markdown content={document.description} />
          </section>
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

        {document.file && <FilePreviewModal open={previewOpen} onOpenChange={setPreviewOpen} file={document.file} />}
      </div>

      <RelatedContent type="document" id={document.id} canEdit={canEdit} />
    </div>
  );
}
