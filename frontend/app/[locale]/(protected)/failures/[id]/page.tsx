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
import { Link, useRouter } from "@/i18n/navigation";
import { deleteFailure, getFailure } from "@/lib/api/engineering";
import type { FailureDetail, FailureSeverity, FailureStatus } from "@/lib/api/types";
import { useHasPermission } from "@/lib/auth/permissions";

const SEVERITY_CLASSES: Record<FailureSeverity, string> = {
  LOW: "bg-surface-variant text-on-surface-variant",
  MEDIUM: "bg-tertiary-container text-on-tertiary-container",
  HIGH: "bg-error-container text-on-error-container",
};

const STATUS_CLASSES: Record<FailureStatus, string> = {
  UNDER_INVESTIGATION: "border border-outline-variant text-on-surface-variant",
  RESOLVED: "bg-secondary-container text-on-secondary-container",
};

// See engineering/page.tsx's failures list for why this doesn't use
// lib/datetime.ts's formatDate() - `date` is a plain calendar date, not a UTC timestamp.
function formatCalendarDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(year, month - 1, day));
}

export default function FailureDetailPage() {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations("engineering.failure");
  const severityT = useTranslations("engineering.failureSeverity");
  const statusT = useTranslations("engineering.failureStatus");
  const router = useRouter();
  const canUpdate = useHasPermission("failure.update");
  const canDelete = useHasPermission("failure.delete");

  const [failure, setFailure] = useState<FailureDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    getFailure(id).then(setFailure, () => setNotFound(true));
  }, [id]);

  if (notFound) {
    return <p className="font-body-md text-body-md text-error">{t("notFound")}</p>;
  }
  if (!failure) {
    return <p className="font-body-md text-body-md text-on-surface-variant">{t("loading")}</p>;
  }

  async function handleDelete() {
    setActionError(null);
    try {
      await deleteFailure(failure!.id);
      router.push("/failures");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="flex flex-col lg:flex-row gap-8 items-start">
    <div className="flex-1 min-w-0 max-w-[800px] space-y-6">
      <Link
        href="/failures"
        className="inline-flex items-center gap-1 font-label-caps text-label-caps uppercase text-on-surface-variant hover:text-on-surface transition-colors"
      >
        <Icon name="arrow_back" size={16} />
        {t("backToList")}
      </Link>

      <div className="border-t-4 border-error rounded-t-xl bg-surface pt-6 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center px-2.5 py-1 rounded-full font-label-caps text-label-caps uppercase ${SEVERITY_CLASSES[failure.severity]}`}
            >
              {severityT(failure.severity)}
            </span>
            <span
              className={`inline-flex items-center px-2.5 py-1 rounded-full font-label-caps text-label-caps uppercase ${STATUS_CLASSES[failure.status]}`}
            >
              {statusT(failure.status)}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <BookmarkButton key={failure.id} type="failure" objectId={failure.id} bookmarkId={failure.bookmark_id} />
            {canUpdate && (
              <Link href={`/failures/${failure.id}/edit`}>
                <IconButton icon="edit" variant="secondary" aria-label={t("editButton")} />
              </Link>
            )}
            {canDelete && (
              <IconButton icon="delete" variant="danger" aria-label={t("deleteButton")} onClick={() => setDeleteOpen(true)} />
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <h1 className="font-display text-display text-on-surface">{failure.title}</h1>
          {failure.visibility === "RESTRICTED" && (
            <span className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-error-container text-on-error-container font-label-caps text-label-caps uppercase">
              <Icon name="lock" size={12} />
              {t("visibilityRESTRICTED")}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-lg font-mono-sm text-mono-sm text-on-surface-variant">
          {failure.date && <span>{formatCalendarDate(failure.date)}</span>}
          {failure.component && (
            <span>
              {t("colComponent")}: {failure.component.name}
            </span>
          )}
          {failure.project && (
            <span>
              {t("projectLabel")}: {failure.project.name}
            </span>
          )}
          {failure.aircraft && <span>{failure.aircraft}</span>}
        </div>
        <ContributorsRow contributors={failure.contributors} />
      </div>

      {actionError && (
        <p className="font-body-md text-body-md text-error" role="alert">
          {actionError}
        </p>
      )}

      {failure.summary && (
        <section>
          <h2 className="font-headline-md text-headline-md text-on-surface mb-2 border-b border-outline-variant pb-1">
            {t("summaryLabel")}
          </h2>
          <Markdown content={failure.summary} />
        </section>
      )}
      {failure.root_cause && (
        <section>
          <h2 className="font-headline-md text-headline-md text-on-surface mb-2 border-b border-outline-variant pb-1">
            {t("rootCauseLabel")}
          </h2>
          <Markdown content={failure.root_cause} />
        </section>
      )}
      {failure.corrective_action && (
        <section>
          <h2 className="font-headline-md text-headline-md text-on-surface mb-2 border-b border-outline-variant pb-1">
            {t("correctiveActionLabel")}
          </h2>
          <Markdown content={failure.corrective_action} />
        </section>
      )}
      {failure.preventive_action && (
        <section>
          <h2 className="font-headline-md text-headline-md text-on-surface mb-2 border-b border-outline-variant pb-1">
            {t("preventiveActionLabel")}
          </h2>
          <Markdown content={failure.preventive_action} />
        </section>
      )}

      <Attachments type="failure" id={failure.id} canEdit={canUpdate} />

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

    <RelatedContent type="failure" id={failure.id} canEdit={canUpdate} />
    </div>
  );
}
