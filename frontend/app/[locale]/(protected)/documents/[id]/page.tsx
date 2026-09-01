"use client";

import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { RelatedContent } from "@/components/knowledge/RelatedContent";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Icon } from "@/components/ui/Icon";
import { IconButton } from "@/components/ui/IconButton";
import { Markdown } from "@/components/ui/Markdown";
import { Link, useRouter } from "@/i18n/navigation";
import { deleteDocument, getDocument } from "@/lib/api/documents";
import { downloadFile } from "@/lib/api/files";
import type { DocumentDetail } from "@/lib/api/types";
import { useAuth } from "@/lib/auth/AuthProvider";
import { useHasPermission } from "@/lib/auth/permissions";

// See knowledge/articles/[id]/page.tsx's matching comment - `date` here is a
// plain "YYYY-MM-DD" calendar date (Django DateField), not a UTC timestamp.
function formatCalendarDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(year, month - 1, day));
}

export default function DocumentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations("engineering.document");
  const docTypeT = useTranslations("engineering.documentType");
  const sourceT = useTranslations("engineering.documentSource");
  const { user } = useAuth();
  const canUpdateAny = useHasPermission("document.update");
  const router = useRouter();

  const [document, setDocument] = useState<DocumentDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    getDocument(id).then(setDocument, () => setNotFound(true));
  }, [id]);

  if (notFound) {
    return <p className="font-body-md text-body-md text-error">{t("notFound")}</p>;
  }
  if (!document) {
    return <p className="font-body-md text-body-md text-on-surface-variant">{t("loading")}</p>;
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
      setActionError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleDownload() {
    if (!document!.file) return;
    setActionError(null);
    try {
      await downloadFile(document!.file.id, document!.file.original_filename);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="flex flex-col lg:flex-row gap-8 items-start">
    <div className="flex-1 min-w-0 max-w-[800px] space-y-6">
      <Link
        href="/documents"
        className="inline-flex items-center gap-1 font-label-caps text-label-caps uppercase text-on-surface-variant hover:text-on-surface transition-colors"
      >
        <Icon name="arrow_back" size={16} />
        {t("backToList")}
      </Link>

      <div className="border-t-4 border-primary rounded-t-xl bg-surface pt-6 space-y-3">
        <div className="flex items-start justify-between gap-3">
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
            {canEdit && (
              <Link href={`/documents/${document.id}/edit`}>
                <IconButton icon="edit" variant="secondary" aria-label={t("editButton")} />
              </Link>
            )}
            {canEdit && (
              <IconButton icon="delete" variant="danger" aria-label={t("deleteButton")} onClick={() => setDeleteOpen(true)} />
            )}
          </div>
        </div>
        <h1 className="font-display text-display text-on-surface">{document.title}</h1>
        <div className="flex flex-wrap items-center gap-lg font-mono-sm text-mono-sm text-on-surface-variant">
          {document.author && <span>{document.author}</span>}
          {document.organization && <span>{document.organization}</span>}
          {document.publication_date && <span>{formatCalendarDate(document.publication_date)}</span>}
          {document.category && (
            <span>
              {t("colCategory")}: {document.category.name}
            </span>
          )}
        </div>
      </div>

      {actionError && (
        <p className="font-body-md text-body-md text-error" role="alert">
          {actionError}
        </p>
      )}

      {(document.file || document.url) && (
        <div className="flex flex-wrap items-center gap-3">
          {document.file && (
            <button
              type="button"
              onClick={handleDownload}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-surface-container-low border border-outline-variant font-body-md text-body-md text-primary hover:bg-surface-variant transition-colors"
            >
              <Icon name="download" size={16} />
              {document.file.original_filename}
            </button>
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
    </div>

    <RelatedContent type="document" id={document.id} canEdit={canEdit} />
    </div>
  );
}
