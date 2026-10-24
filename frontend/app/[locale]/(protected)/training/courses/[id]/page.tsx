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
import { DetailMessage } from "@/components/ui/DetailMessage";
import { Icon } from "@/components/ui/Icon";
import { IconButton } from "@/components/ui/IconButton";
import { Markdown } from "@/components/ui/Markdown";
import { Modal } from "@/components/ui/Modal";
import { DetailPageSkeleton } from "@/components/ui/Skeleton";
import { UpdatedBadge } from "@/components/ui/UpdatedBadge";
import { Link, useRouter } from "@/i18n/navigation";
import { errorMessage } from "@/lib/errors";
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
import type { CourseProgress } from "@/lib/api/types";
import { useAuth } from "@/lib/auth/AuthProvider";
import { useHasPermission } from "@/lib/auth/permissions";
import { useResource } from "@/lib/useResource";

export default function CourseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations("training.course");
  const workflowT = useTranslations("training.workflow");
  const manageT = useTranslations("training.manage");
  const cardT = useTranslations("training.card");
  const { user } = useAuth();
  const router = useRouter();

  const canUpdateAny = useHasPermission("training.update");
  const canDeleteAny = useHasPermission("training.delete");
  const canPublish = useHasPermission("training.publish");
  const canReview = useHasPermission("training.review");
  const canArchive = useHasPermission("training.archive");

  const { data: course, setData: setCourse, notFound } = useResource(id, getCourse);
  const [progress, setProgress] = useState<CourseProgress | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [isWorking, setIsWorking] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (!course) return;
    getCourseProgress(course.id).then(setProgress);
    // Only course.id/status matter here - re-running on every setCourse() from
    // the workflow handlers below would refetch progress that hasn't changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [course?.id, course?.status]);

  const completedLessonIds = useMemo(() => new Set(progress?.completed_lesson_ids ?? []), [progress]);

  if (notFound) {
    return <DetailMessage error>{t("notFound")}</DetailMessage>;
  }
  if (!course) {
    return <DetailPageSkeleton withSidebar={false} />;
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
      setActionError(errorMessage(err));
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
      setActionError(errorMessage(err));
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
      setActionError(errorMessage(err));
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
      setActionError(errorMessage(err));
    }
  }

  async function handleArchive() {
    setActionError(null);
    try {
      setCourse(await archiveCourse(course!.id));
    } catch (err) {
      setActionError(errorMessage(err));
    }
  }

  async function handleUnarchive() {
    setIsWorking(true);
    setActionError(null);
    try {
      setCourse(await unarchiveCourse(course!.id));
    } catch (err) {
      setActionError(errorMessage(err));
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
      setActionError(errorMessage(err));
    }
  }

  return (
    <div className="space-y-6 max-w-[1200px] mx-auto pb-12">
      <Link
        href="/training"
        className="inline-flex items-center gap-1 font-label-caps text-label-caps uppercase text-on-surface-variant hover:text-on-surface transition-colors"
      >
        <Icon name="arrow_back" size={16} />
        {t("backToTraining")}
      </Link>

      {isPreview && (
        <div className="flex items-center gap-2 bg-tertiary-container text-on-tertiary-container rounded-xl px-4 py-3 font-body-md text-body-md shadow-xs">
          <Icon name="visibility" size={18} />
          {t("previewBanner")}
        </div>
      )}

      {actionError && (
        <p className="font-body-md text-body-md text-error" role="alert">
          {actionError}
        </p>
      )}

      {/* Modern 2-Column LMS Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
        {/* Left Column: Course Header, Description & Curriculum */}
        <div className="lg:col-span-2 space-y-6">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex items-center gap-1 font-label-caps text-label-caps uppercase text-primary">
                <Icon name="school" size={14} />
                {t("badgeLabel")}
              </span>
              <CourseStatusPill status={course.status} />
              <DifficultyPill difficulty={course.difficulty} />
              {course.category && <CategoryBadge name={course.category.name} />}
              {course.visibility === "RESTRICTED" && (
                <span className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-error-container text-on-error-container font-label-caps text-label-caps uppercase">
                  <Icon name="lock" size={12} />
                  {manageT("visibilityRESTRICTED")}
                </span>
              )}
            </div>

            <h1 className="font-display text-display text-on-surface font-extrabold tracking-tight">
              {course.title}
            </h1>

            {course.short_description && (
              <p className="font-body-lg text-body-lg text-on-surface-variant leading-relaxed">
                {course.short_description}
              </p>
            )}

            {/* Byline & Metadata */}
            <div className="flex flex-wrap items-center gap-4 pt-3 border-t border-outline-variant/60 font-body-sm text-body-sm text-on-surface-variant">
              {authorName && course.author?.id ? (
                <Link
                  href={`/users/${course.author.id}`}
                  className="flex items-center gap-2 group hover:text-primary transition-colors"
                >
                  <Avatar person={course.author} size="sm" />
                  <span className="font-medium text-on-surface group-hover:text-primary group-hover:underline">
                    {authorName}
                  </span>
                </Link>
              ) : authorName ? (
                <div className="flex items-center gap-2">
                  <Avatar person={course.author} size="sm" />
                  <span className="font-medium text-on-surface">{authorName}</span>
                </div>
              ) : null}
              <UpdatedBadge updatedAt={course.updated_at} createdAt={course.created_at} />
            </div>
          </div>

          {/* Workflow Actions Banner for Admins/Authors */}
          {(canSubmit || canPublishNow || canRejectNow || canUnarchiveNow || canEdit) && (
            <div className="flex flex-wrap items-center gap-2.5 p-3 rounded-xl bg-surface-container-low border border-outline-variant">
              {canEdit && (
                <Link href={`/training/manage/courses/${course.id}`}>
                  <Button variant="secondary" size="sm">
                    <Icon name="edit" size={16} />
                    {t("manageEditLink") || t("editButton")}
                  </Button>
                </Link>
              )}
              {canSubmit && (
                <Button size="sm" onClick={handleSubmit} disabled={isWorking}>
                  {workflowT("submitForReview")}
                </Button>
              )}
              {canPublishNow && (
                <Button size="sm" onClick={handlePublish} disabled={isWorking}>
                  {workflowT("publish")}
                </Button>
              )}
              {canRejectNow && (
                <Button variant="secondary" size="sm" onClick={() => setRejectOpen(true)} disabled={isWorking}>
                  {workflowT("rejectButton")}
                </Button>
              )}
              {canUnarchiveNow && (
                <Button size="sm" onClick={handleUnarchive} disabled={isWorking}>
                  <Icon name="unarchive" size={16} />
                  {workflowT("unarchiveButton")}
                </Button>
              )}
              {canArchiveNow && (
                <IconButton
                  icon="archive"
                  variant="secondary"
                  size={16}
                  aria-label={workflowT("archiveButton")}
                  disabled={isWorking}
                  onClick={() => setArchiveOpen(true)}
                />
              )}
              {canDelete && (
                <IconButton
                  icon="delete"
                  variant="danger"
                  size={16}
                  aria-label={workflowT("deleteButton")}
                  onClick={() => setDeleteOpen(true)}
                />
              )}
            </div>
          )}

          {/* Course Description Card */}
          {course.description && (
            <div className="rounded-xl border border-outline-variant bg-surface-container-low p-5 sm:p-6 space-y-3">
              <h2 className="font-headline-sm text-headline-sm font-bold text-on-surface">
                {t("overviewTitle") || "About this course"}
              </h2>
              <Markdown content={course.description} />
            </div>
          )}

          {/* Course Curriculum List */}
          <div className="space-y-4">
            <div>
              <h2 className="font-headline-md text-headline-md font-bold text-on-surface">
                {t("curriculumTitle")}
              </h2>
              <p className="font-body-sm text-body-sm text-on-surface-variant mt-0.5">
                {cardT("moduleCount", { count: course.module_count })} &middot;{" "}
                {cardT("lessonCount", { count: course.lesson_count })}
                {course.estimated_minutes > 0 && ` · ${cardT("minutes", { count: course.estimated_minutes })}`}
              </p>
            </div>

            {course.modules.length === 0 ? (
              <div className="rounded-xl border border-dashed border-outline-variant p-8 text-center text-on-surface-variant">
                <Icon name="folder_open" size={32} className="mx-auto mb-2 opacity-50" />
                <p className="font-body-md text-body-md">{t("moduleEmptyState")}</p>
                {canEdit && (
                  <Link href={`/training/manage/courses/${course.id}`} className="inline-block mt-3">
                    <Button variant="secondary" size="sm">
                      <Icon name="add" size={16} />
                      {manageT("addModuleButton")}
                    </Button>
                  </Link>
                )}
              </div>
            ) : (
              <CurriculumList
                courseId={course.id}
                modules={course.modules}
                completedLessonIds={completedLessonIds}
                variant="detail"
              />
            )}
          </div>
        </div>

        {/* Right Column: Sticky Action & Facts Card */}
        <div className="lg:col-span-1 space-y-4 lg:sticky lg:top-6">
          <div className="rounded-2xl border border-outline-variant bg-surface-container-low shadow-sm overflow-hidden">
            {course.cover_image && (
              <div className="aspect-video w-full overflow-hidden bg-surface-container-high border-b border-outline-variant">
                <AuthenticatedImage
                  src={course.cover_image.download_url}
                  alt=""
                  className="h-full w-full object-cover"
                />
              </div>
            )}

            <div className="p-5 space-y-5">
              {/* Enrollment / Continue CTA */}
              {!isPreview && course.status === "PUBLISHED" && (
                <div className="space-y-3">
                  {progress?.enrolled ? (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-body-sm text-body-sm text-on-surface-variant">
                          {t("progressLabel", {
                            completed: progress.completed_lessons,
                            total: progress.total_lessons,
                          })}
                        </span>
                        <span className="font-headline-sm text-headline-sm font-bold text-primary">
                          {Math.round(progress.percent)}%
                        </span>
                      </div>
                      <div className="h-2 w-full rounded-full bg-surface-variant overflow-hidden">
                        <div
                          className="h-full bg-primary rounded-full transition-all duration-300"
                          style={{ width: `${progress.percent}%` }}
                        />
                      </div>
                      {progress.next_lesson_id ? (
                        <Link
                          href={`/training/courses/${course.id}/learn/${progress.next_lesson_id}`}
                          className="block"
                        >
                          <Button className="w-full">
                            <Icon name="play_arrow" size={18} />
                            {t("continueButton")}
                          </Button>
                        </Link>
                      ) : (
                        <div className="text-center p-2 rounded-lg bg-primary-container/20 text-primary font-label-caps text-label-caps">
                          {t("progressCompleted") || "All lessons completed"}
                        </div>
                      )}
                    </div>
                  ) : (
                    <Button onClick={handleEnroll} disabled={isWorking} className="w-full">
                      <Icon name="school" size={18} />
                      {isWorking ? t("enrolling") : t("startCourseButton")}
                    </Button>
                  )}
                </div>
              )}

              {/* Course Highlights */}
              <div className="space-y-3 pt-3 border-t border-outline-variant/60 font-body-sm text-body-sm">
                <h4 className="font-label-caps text-label-caps uppercase text-on-surface-variant">
                  {t("highlightsTitle") || "Course Highlights"}
                </h4>
                <ul className="space-y-2.5 text-on-surface">
                  <li className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 text-on-surface-variant">
                      <Icon name="folder" size={16} className="text-on-surface-variant/70" />
                      Modules
                    </span>
                    <span className="font-medium font-mono">{course.module_count}</span>
                  </li>
                  <li className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 text-on-surface-variant">
                      <Icon name="menu_book" size={16} className="text-on-surface-variant/70" />
                      Lessons
                    </span>
                    <span className="font-medium font-mono">{course.lesson_count}</span>
                  </li>
                  {course.estimated_minutes > 0 && (
                    <li className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2 text-on-surface-variant">
                        <Icon name="schedule" size={16} className="text-on-surface-variant/70" />
                        Duration
                      </span>
                      <span className="font-medium font-mono">{course.estimated_minutes} min</span>
                    </li>
                  )}
                  <li className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 text-on-surface-variant">
                      <Icon name="speed" size={16} className="text-on-surface-variant/70" />
                      Level
                    </span>
                    <span className="font-medium capitalize">{course.difficulty.toLowerCase()}</span>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>
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
