"use client";

import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { Attachments } from "@/components/knowledge/Attachments";
import { ContributorsRow } from "@/components/knowledge/Contributors";
import { RelatedContent } from "@/components/knowledge/RelatedContent";
import { BookmarkButton } from "@/components/ui/BookmarkButton";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Icon } from "@/components/ui/Icon";
import { IconButton } from "@/components/ui/IconButton";
import { Markdown } from "@/components/ui/Markdown";
import { TagChip } from "@/components/ui/TagChip";
import { Link, useRouter } from "@/i18n/navigation";
import { deleteSop, getSop } from "@/lib/api/engineering";
import type { SopDetail } from "@/lib/api/types";
import { useHasPermission } from "@/lib/auth/permissions";

export default function SopDetailPage() {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations("engineering.sop");
  const router = useRouter();
  const canUpdate = useHasPermission("sop.update");
  const canDelete = useHasPermission("sop.delete");

  const [sop, setSop] = useState<SopDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    getSop(id).then(setSop, () => setNotFound(true));
  }, [id]);

  if (notFound) {
    return <p className="font-body-md text-body-md text-error">{t("notFound")}</p>;
  }
  if (!sop) {
    return <p className="font-body-md text-body-md text-on-surface-variant">{t("loading")}</p>;
  }

  async function handleDelete() {
    setActionError(null);
    try {
      await deleteSop(sop!.id);
      router.push("/sops");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="flex flex-col lg:flex-row gap-8 items-start">
    <div className="flex-1 w-full min-w-0 max-w-[800px] space-y-6">
      <Link
        href="/sops"
        className="inline-flex items-center gap-1 font-label-caps text-label-caps uppercase text-on-surface-variant hover:text-on-surface transition-colors"
      >
        <Icon name="arrow_back" size={16} />
        {t("backToList")}
      </Link>

      <div className="border-t-4 border-primary rounded-t-xl bg-surface pt-6 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="bg-primary-container text-on-primary-container font-label-caps text-label-caps px-2.5 py-1 rounded-full uppercase">
              {t("badgeLabel")}
            </span>
            {sop.mandatory && (
              <span className="bg-surface-container-high text-on-surface-variant font-label-caps text-label-caps px-2.5 py-1 rounded-full uppercase">
                {t("mandatoryLabel")}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <BookmarkButton key={sop.id} type="sop" objectId={sop.id} bookmarkId={sop.bookmark_id} />
            {canUpdate && (
              <Link href={`/sops/${sop.id}/edit`}>
                <IconButton icon="edit" variant="secondary" aria-label={t("editButton")} />
              </Link>
            )}
            {canDelete && (
              <IconButton icon="delete" variant="danger" aria-label={t("deleteButton")} onClick={() => setDeleteOpen(true)} />
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <h1 className="font-display text-display text-on-surface">{sop.title}</h1>
          {sop.visibility === "RESTRICTED" && (
            <span className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-error-container text-on-error-container font-label-caps text-label-caps uppercase">
              <Icon name="lock" size={12} />
              {t("visibilityRESTRICTED")}
            </span>
          )}
        </div>
        {sop.tags.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {sop.tags.map((tag) => (
              <TagChip key={tag.id} tag={tag} />
            ))}
          </div>
        )}
        <ContributorsRow contributors={sop.contributors} />
      </div>

      {actionError && (
        <p className="font-body-md text-body-md text-error" role="alert">
          {actionError}
        </p>
      )}

      {sop.safety_notes && (
        <div className="bg-error-container border-s-4 border-error rounded-e-xl p-4 flex gap-3 items-start">
          <Icon name="report_problem" size={20} className="text-on-error-container shrink-0 mt-0.5" />
          <div>
            <h3 className="font-headline-md text-headline-md text-on-error-container mb-1">{t("safetyNotesLabel")}</h3>
            <p className="font-body-md text-body-md text-on-error-container">{sop.safety_notes}</p>
          </div>
        </div>
      )}

      {sop.content ? (
        <Markdown content={sop.content} />
      ) : (
        <p className="font-body-md text-body-md text-on-surface-variant">{t("noContent")}</p>
      )}

      <Attachments type="sop" id={sop.id} canEdit={canUpdate} />

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

    <RelatedContent type="sop" id={sop.id} canEdit={canUpdate} />
    </div>
  );
}
