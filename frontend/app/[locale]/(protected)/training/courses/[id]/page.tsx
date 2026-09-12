"use client";

import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { CourseStatusPill } from "@/components/training/CourseStatusPill";
import { CurriculumList } from "@/components/training/CurriculumList";
import { DifficultyPill } from "@/components/training/DifficultyPill";
import { AuthenticatedImage } from "@/components/ui/AuthenticatedImage";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { CategoryBadge } from "@/components/ui/CategoryBadge";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Icon } from "@/components/ui/Icon";
import { IconButton } from "@/components/ui/IconButton";
import { Markdown } from "@/components/ui/Markdown";
import { Modal } from "@/components/ui/Modal";
import { Link, useRouter } from "@/i18n/navigation";
import { formatPersonName } from "@/lib/format";
import {
  archiveCourse,
  deleteCourse,
  enrollInCourse,
  getCourse,
  getCourseProgress,
  publishCourse,
  rejectCourse,
  submitCourse,
  unarchiveCourse,
} from "@/lib/api/training";
import type { CourseDetail, CourseProgress } from "@/lib/api/types";
import { useAuth } from "@/lib/auth/AuthProvider";
import { useHasPermission } from "@/lib/auth/permissions";

export default function CourseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations("training.course");
  const workflowT = useTranslations("training.workflow");
  const cardT = useTranslations("training.card");
  const { user } = useAuth();
  const router = useRouter();

  const canUpdateAny = useHasPermission("training.update");
  const canDeleteAny = useHasPermission("training.delete");
  const canPublish = useHasPermission("training.publish");
  const canReview = useHasPermission("training.review");
  const canArchive = useHasPermission("training.archive");

  const [course, setCourse] = useState<CourseDetail | null>(null);
  const [progress, setProgress] = useState<CourseProgress | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [isWorking, setIsWorking] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    getCourse(id).then(setCourse, () => setNotFound(true));
  }, [id]);

  useEffect(() => {
    if (!course) return;
    getCourseProgress(course.id).then(setProgress);
    // Only course.id/status matter here - re-running on every setCourse() from
    // the workflow handlers below would refetch progress that hasn't changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [course?.id, course?.status]);

  const completedLessonIds = useMemo(() => new Set(progress?.completed_lesson_ids ?? []), [progress]);

  if (notFound) {
    return <p className="font-body-md text-body-md text-error">{t("notFound")}</p>;
  }
  if (!course) {
    return <p className="font-body-md text-body-md text-on-surface-variant">{t("loading")}</p>;
  }

  const isAuthor = user?.id === course.author?.id;
  const canEdit = isAuthor || canUpdateAny;
  const canDelete = (isAuthor && course.status === "DRAFT") || canDeleteAny;
  const canSubmit = isAuthor && (course.status === "DRAFT" || course.status === "REJECTED");
  const canPublishNow = canPublish && (course.status === "DRAFT" || course.status === "IN_REVIEW");
  const canRejectNow = canReview && course.status === "IN_REVIEW";
  const canArchiveNow = canArchive && course.status === "PUBLISHED";
  const canUnarchiveNow = canArchive && course.status === "ARCHIVED";
  const isPreview = course.status !== "PUBLISHED" && canEdit;
  const authorName = formatPersonName(course.author);

  async function handleEnroll() {
    setIsWorking(true);
    setActionError(null);
    try {
      await enrollInCourse(course!.id);
      setProgress(await getCourseProgress(course!.id));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsWorking(false);
    }
  }

  async function handleSubmit() {
    setIsWorking(true);
    setActionError(null);
    try {
      setCourse(await submitCourse(course!.id));
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
      setCourse(await publishCourse(course!.id));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsWorking(false);
    }
  }

  async function handleReject() {
    setActionError(null);
    try {
      setCourse(await rejectCourse(course!.id, rejectReason.trim()));
      setRejectReason("");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleArchive() {
    setActionError(null);
    try {
      setCourse(await archiveCourse(course!.id));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleUnarchive() {
    setIsWorking(true);
    setActionError(null);
    try {
      setCourse(await unarchiveCourse(course!.id));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsWorking(false);
    }
  }

  async function handleDelete() {
    setActionError(null);
    try {
      await deleteCourse(course!.id);
      router.push("/training");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="space-y-6 max-w-[1000px] mx-auto">
      <Link
        href="/training"
        className="inline-flex items-center gap-1 font-label-caps text-label-caps uppercase text-on-surface-variant hover:text-on-surface transition-colors"
      >
        <Icon name="arrow_back" size={16} />
        {t("backToTraining")}
      </Link>

      {isPreview && (
        <div className="flex items-center gap-2 bg-tertiary-container text-on-tertiary-container rounded-xl px-4 py-3 font-body-md text-body-md">
          <Icon name="visibility" size={18} />
          {t("previewBanner")}
        </div>
      )}

      {course.cover_image && (
        <div className="h-56 rounded-xl overflow-hidden bg-surface-container-high">
          <AuthenticatedImage src={course.cover_image.download_url} alt="" className="h-full w-full object-cover" />
        </div>
      )}

      <div className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1 font-label-caps text-label-caps uppercase text-primary">
              <Icon name="school" size={14} />
              {t("badgeLabel")}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {canEdit && (
              <Link href={`/training/manage/courses/${course.id}`}>
                <IconButton icon="edit" variant="secondary" aria-label={t("editButton")} />
              </Link>
            )}
            {canArchiveNow && (
              <IconButton
                icon="archive"
                variant="secondary"
                aria-label={workflowT("archiveButton")}
                disabled={isWorking}
                onClick={() => setArchiveOpen(true)}
              />
            )}
            {canDelete && (
              <IconButton
                icon="delete"
                variant="danger"
                aria-label={workflowT("deleteButton")}
                onClick={() => setDeleteOpen(true)}
              />
            )}
          </div>
        </div>
        <h1 className="font-display text-display text-on-surface">{course.title}</h1>

        {/* Tier 1: status/difficulty - the two things worth a glance from
            across the room, so they get color and weight. */}
        <div className="flex flex-wrap items-center gap-2">
          <CourseStatusPill status={course.status} />
          <DifficultyPill difficulty={course.difficulty} />
          {course.category && <CategoryBadge name={course.category.name} />}
        </div>

        {/* Tier 2: quantitative facts - icon + text, quieter than the pills above. */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 font-body-md text-body-md text-on-surface-variant">
          {course.estimated_minutes > 0 && (
            <span className="flex items-center gap-1.5">
              <Icon name="schedule" size={16} className="text-on-surface-variant/70" />
              {cardT("minutes", { count: course.estimated_minutes })}
            </span>
          )}
          <span className="flex items-center gap-1.5">
            <Icon name="folder_open" size={16} className="text-on-surface-variant/70" />
            {cardT("moduleCount", { count: course.module_count })}
          </span>
          <span className="flex items-center gap-1.5">
            <Icon name="menu_book" size={16} className="text-on-surface-variant/70" />
            {cardT("lessonCount", { count: course.lesson_count })}
          </span>
        </div>

        {/* Tier 3: the byline - personal/attribution, set apart with a small divider. */}
        {authorName && (
          <div className="flex items-center gap-2 pt-2 border-t border-outline-variant/60">
            <Avatar person={course.author} size="sm" />
            <span className="font-body-md text-body-md text-on-surface-variant">{t("byAuthor", { name: authorName })}</span>
          </div>
        )}
      </div>

      {(canSubmit || canPublishNow || canRejectNow || canUnarchiveNow) && (
        <div className="flex flex-wrap items-center gap-3 pb-4 border-b border-outline-variant">
          {canSubmit && (
            <Button onClick={handleSubmit} disabled={isWorking}>
              {workflowT("submitForReview")}
            </Button>
          )}
          {canPublishNow && (
            <Button onClick={handlePublish} disabled={isWorking}>
              {workflowT("publish")}
            </Button>
          )}
          {canRejectNow && (
            <Button variant="secondary" onClick={() => setRejectOpen(true)} disabled={isWorking}>
              {workflowT("rejectButton")}
            </Button>
          )}
          {canUnarchiveNow && (
            <Button onClick={handleUnarchive} disabled={isWorking}>
              <Icon name="unarchive" size={18} />
              {workflowT("unarchiveButton")}
            </Button>
          )}
        </div>
      )}

      {actionError && (
        <p className="font-body-md text-body-md text-error" role="alert">
          {actionError}
        </p>
      )}

      {!isPreview && course.status === "PUBLISHED" && progress && (
        <div className="bg-surface-container-low border border-outline-variant rounded-xl p-4 space-y-3">
          {progress.enrolled ? (
            <>
              <div className="flex items-center justify-between gap-2">
                <span className="font-body-md text-body-md text-on-surface-variant">
                  {t("progressLabel", { completed: progress.completed_lessons, total: progress.total_lessons })}
                </span>
                <span className="font-headline-md text-headline-md text-primary">{Math.round(progress.percent)}%</span>
              </div>
              <div className="h-2 w-full rounded-full bg-surface-variant overflow-hidden">
                <div className="h-full bg-primary rounded-full" style={{ width: `${progress.percent}%` }} />
              </div>
              {progress.status === "IN_PROGRESS" && progress.next_lesson_id && (
                <Link href={`/training/courses/${course.id}/learn/${progress.next_lesson_id}`}>
                  <Button>{t("continueButton")}</Button>
                </Link>
              )}
            </>
          ) : (
            <Button onClick={handleEnroll} disabled={isWorking}>
              {isWorking ? t("enrolling") : t("startCourseButton")}
            </Button>
          )}
        </div>
      )}

      {course.description && <Markdown content={course.description} />}

      <div className="space-y-3">
        <h2 className="font-headline-md text-headline-md text-on-surface">{t("curriculumTitle")}</h2>
        {course.modules.length === 0 ? (
          <p className="font-body-md text-body-md text-on-surface-variant">{t("moduleEmptyState")}</p>
        ) : (
          <CurriculumList courseId={course.id} modules={course.modules} completedLessonIds={completedLessonIds} />
        )}
      </div>

      <ConfirmModal
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={workflowT("deleteConfirmTitle")}
        description={workflowT("deleteConfirmBody")}
        confirmLabel={workflowT("deleteButton")}
        danger
        onConfirm={handleDelete}
      />

      <ConfirmModal
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        title={workflowT("archiveConfirmTitle")}
        description={workflowT("archiveConfirmBody")}
        confirmLabel={workflowT("archiveButton")}
        onConfirm={handleArchive}
      />

      <Modal
        open={rejectOpen}
        onOpenChange={setRejectOpen}
        title={workflowT("rejectModalTitle")}
        isDirty={rejectReason.length > 0}
        footer={
          <Button variant="danger" onClick={handleReject}>
            {workflowT("rejectButton")}
          </Button>
        }
      >
        <div className="space-y-2">
          <label className="block font-label-caps text-label-caps text-on-surface-variant uppercase">
            {workflowT("rejectReasonLabel")}
          </label>
          <textarea
            className="block w-full min-h-[100px] px-4 py-2 font-body-md text-body-md text-on-surface bg-surface-container border border-outline-variant rounded-lg focus:ring-1 focus:ring-primary focus:border-primary outline-none transition-colors"
            placeholder={workflowT("rejectReasonPlaceholder")}
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
          />
        </div>
      </Modal>
    </div>
  );
}
