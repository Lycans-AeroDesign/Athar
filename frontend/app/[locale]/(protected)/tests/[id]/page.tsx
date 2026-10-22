"use client";

import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { useState } from "react";

import { TEST_PASS_FAIL_CLASSES, TEST_STATUS_CLASSES } from "@/components/engineering/statusClasses";
import { Attachments } from "@/components/knowledge/Attachments";
import { ContributorsRow } from "@/components/knowledge/Contributors";
import { RelatedContent } from "@/components/knowledge/RelatedContent";
import { BookmarkButton } from "@/components/ui/BookmarkButton";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { DetailMessage } from "@/components/ui/DetailMessage";
import { Icon } from "@/components/ui/Icon";
import { IconButton } from "@/components/ui/IconButton";
import { Markdown } from "@/components/ui/Markdown";
import { DetailPageSkeleton } from "@/components/ui/Skeleton";
import { Link, useRouter } from "@/i18n/navigation";
import { deleteTest, getTest } from "@/lib/api/engineering";
import { useHasPermission } from "@/lib/auth/permissions";
import { errorMessage } from "@/lib/errors";
import { formatCalendarDate } from "@/lib/format";
import { useResource } from "@/lib/useResource";

export default function TestDetailPage() {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations("engineering.test");
  const typeT = useTranslations("engineering.testType");
  const statusT = useTranslations("engineering.testStatus");
  const passFailT = useTranslations("engineering.testPassFail");
  const router = useRouter();
  const canUpdate = useHasPermission("test.update");
  const canDelete = useHasPermission("test.delete");

  const { data: test, notFound } = useResource(id, getTest);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  if (notFound) {
    return <DetailMessage error>{t("notFound")}</DetailMessage>;
  }
  if (!test) {
    return <DetailPageSkeleton />;
  }

  async function handleDelete() {
    setActionError(null);
    try {
      await deleteTest(test!.id);
      router.push("/tests");
    } catch (err) {
      setActionError(errorMessage(err));
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
              className={`inline-flex items-center px-2.5 py-1 rounded-full font-label-caps text-label-caps uppercase ${TEST_STATUS_CLASSES[test.status]}`}
            >
              {statusT(test.status)}
            </span>
            {test.pass_fail && (
              <span
                className={`inline-flex items-center px-2.5 py-1 rounded-full font-label-caps text-label-caps uppercase ${TEST_PASS_FAIL_CLASSES[test.pass_fail]}`}
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
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono-sm text-mono-sm text-on-surface-variant">
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
