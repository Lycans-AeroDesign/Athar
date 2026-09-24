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
import { deleteTest, getTest } from "@/lib/api/engineering";
import type { TestDetail, TestPassFail, TestRunStatus } from "@/lib/api/types";
import { useHasPermission } from "@/lib/auth/permissions";

const STATUS_CLASSES: Record<TestRunStatus, string> = {
  PLANNED: "border border-outline-variant text-on-surface-variant",
  IN_PROGRESS: "bg-tertiary-container text-on-tertiary-container",
  COMPLETED: "bg-secondary-container text-on-secondary-container",
};

const PASS_FAIL_CLASSES: Record<Exclude<TestPassFail, "">, string> = {
  PASS: "bg-secondary-container text-on-secondary-container",
  FAIL: "bg-error-container text-on-error-container",
  PARTIAL: "bg-tertiary-container text-on-tertiary-container",
  NOT_APPLICABLE: "border border-outline-variant text-on-surface-variant",
};

// See tests/page.tsx's list for why this doesn't use lib/datetime.ts's
// formatDate() - `date` is a plain calendar date, not a UTC timestamp.
function formatCalendarDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(year, month - 1, day));
}

export default function TestDetailPage() {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations("engineering.test");
  const typeT = useTranslations("engineering.testType");
  const statusT = useTranslations("engineering.testStatus");
  const passFailT = useTranslations("engineering.testPassFail");
  const router = useRouter();
  const canUpdate = useHasPermission("test.update");
  const canDelete = useHasPermission("test.delete");

  const [test, setTest] = useState<TestDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    getTest(id).then(setTest, () => setNotFound(true));
  }, [id]);

  if (notFound) {
    return <p className="font-body-md text-body-md text-error">{t("notFound")}</p>;
  }
  if (!test) {
    return <p className="font-body-md text-body-md text-on-surface-variant">{t("loading")}</p>;
  }

  async function handleDelete() {
    setActionError(null);
    try {
      await deleteTest(test!.id);
      router.push("/tests");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="flex flex-col lg:flex-row gap-8 items-start">
    <div className="flex-1 w-full min-w-0 max-w-[800px] space-y-6">
      <Link
        href="/tests"
        className="inline-flex items-center gap-1 font-label-caps text-label-caps uppercase text-on-surface-variant hover:text-on-surface transition-colors"
      >
        <Icon name="arrow_back" size={16} />
        {t("backToList")}
      </Link>

      <div className="border-t-4 border-primary rounded-t-xl bg-surface pt-6 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center px-2.5 py-1 rounded-full font-label-caps text-label-caps uppercase border border-outline-variant text-on-surface-variant">
              {typeT(test.test_type)}
            </span>
            <span
              className={`inline-flex items-center px-2.5 py-1 rounded-full font-label-caps text-label-caps uppercase ${STATUS_CLASSES[test.status]}`}
            >
              {statusT(test.status)}
            </span>
            {test.pass_fail && (
              <span
                className={`inline-flex items-center px-2.5 py-1 rounded-full font-label-caps text-label-caps uppercase ${PASS_FAIL_CLASSES[test.pass_fail]}`}
              >
                {passFailT(test.pass_fail)}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <BookmarkButton key={test.id} type="test" objectId={test.id} bookmarkId={test.bookmark_id} />
            {canUpdate && (
              <Link href={`/tests/${test.id}/edit`}>
                <IconButton icon="edit" variant="secondary" aria-label={t("editButton")} />
              </Link>
            )}
            {canDelete && (
              <IconButton icon="delete" variant="danger" aria-label={t("deleteButton")} onClick={() => setDeleteOpen(true)} />
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <h1 className="font-display text-display text-on-surface">{test.title}</h1>
          {test.visibility === "RESTRICTED" && (
            <span className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-error-container text-on-error-container font-label-caps text-label-caps uppercase">
              <Icon name="lock" size={12} />
              {t("visibilityRESTRICTED")}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-lg font-mono-sm text-mono-sm text-on-surface-variant">
          {test.date && <span>{formatCalendarDate(test.date)}</span>}
          {test.project && (
            <span>
              {t("projectLabel")}: {test.project.name}
            </span>
          )}
          {test.location && <span>{test.location}</span>}
        </div>
        <ContributorsRow contributors={test.contributors} />
      </div>

      {actionError && (
        <p className="font-body-md text-body-md text-error" role="alert">
          {actionError}
        </p>
      )}

      {test.objective && (
        <section>
          <h2 className="font-headline-md text-headline-md text-on-surface mb-2 border-b border-outline-variant pb-1">
            {t("objectiveLabel")}
          </h2>
          <Markdown content={test.objective} />
        </section>
      )}
      {test.configuration && (
        <section>
          <h2 className="font-headline-md text-headline-md text-on-surface mb-2 border-b border-outline-variant pb-1">
            {t("configurationLabel")}
          </h2>
          <Markdown content={test.configuration} />
        </section>
      )}
      {test.procedure && (
        <section>
          <h2 className="font-headline-md text-headline-md text-on-surface mb-2 border-b border-outline-variant pb-1">
            {t("procedureLabel")}
          </h2>
          <Markdown content={test.procedure} />
        </section>
      )}
      {test.results && (
        <section>
          <h2 className="font-headline-md text-headline-md text-on-surface mb-2 border-b border-outline-variant pb-1">
            {t("resultsLabel")}
          </h2>
          <Markdown content={test.results} />
        </section>
      )}
      {test.conclusion && (
        <section>
          <h2 className="font-headline-md text-headline-md text-on-surface mb-2 border-b border-outline-variant pb-1">
            {t("conclusionLabel")}
          </h2>
          <Markdown content={test.conclusion} />
        </section>
      )}

      <Attachments type="test" id={test.id} canEdit={canUpdate} />

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

    <RelatedContent type="test" id={test.id} canEdit={canUpdate} />
    </div>
  );
}
