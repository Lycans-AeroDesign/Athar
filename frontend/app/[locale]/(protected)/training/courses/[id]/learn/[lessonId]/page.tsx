"use client";

import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { CurriculumList } from "@/components/training/CurriculumList";
import { LessonContent } from "@/components/training/LessonContent";
import { LessonResourceList } from "@/components/training/LessonResourceList";
import { RelatedKnowledgePanel } from "@/components/training/RelatedKnowledgePanel";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { CourseLearnPageSkeleton } from "@/components/ui/Skeleton";
import { Link } from "@/i18n/navigation";
import { completeLesson, enrollInCourse, getCourse, getCourseProgress, getLesson } from "@/lib/api/training";
import type { CourseDetail, CourseProgress, LessonDetail, LessonSummary } from "@/lib/api/types";
import { useAuth } from "@/lib/auth/AuthProvider";
import { useHasPermission } from "@/lib/auth/permissions";
import { errorMessage } from "@/lib/errors";

const RESOURCE_TYPES_RENDERED_INLINE = new Set(["VIDEO", "DOCUMENT", "EXTERNAL"]);

export default function LessonViewerPage() {
  const { id, lessonId } = useParams<{ id: string; lessonId: string }>();
  const t = useTranslations("training.lesson");
  const courseT = useTranslations("training.course");
  const canUpdateAny = useHasPermission("training.update");
  const { user } = useAuth();

  const [course, setCourse] = useState<CourseDetail | null>(null);
  // Keyed by the lessonId it was fetched for (rather than reset with a
  // separate setLesson(null) at the top of the effect below) - same pattern
  // AuthenticatedImage.tsx uses, avoiding the react-hooks/set-state-in-effect
  // lint rule flagging a synchronous setState at the start of an effect.
  const [lessonResult, setLessonResult] = useState<{ lessonId: string; lesson: LessonDetail } | null>(null);
  const lesson = lessonResult?.lessonId === lessonId ? lessonResult.lesson : null;
  const [progress, setProgress] = useState<CourseProgress | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);
  const [isEnrolling, setIsEnrolling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getCourse(id).then(setCourse, () => setNotFound(true));
  }, [id]);

  useEffect(() => {
    getLesson(lessonId).then((data) => setLessonResult({ lessonId, lesson: data }), () => setNotFound(true));
  }, [lessonId]);

  useEffect(() => {
    if (!course) return;
    getCourseProgress(course.id).then(setProgress);
    // Only course.id matters here - re-running this on every setCourse() call
    // elsewhere (there are none on this page, but matching the course detail
    // page's own precedent) would refetch progress that hasn't changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [course?.id]);

  const flatLessons = useMemo<LessonSummary[]>(
    () => (course ? course.modules.flatMap((module) => module.lessons) : []),
    [course],
  );
  const currentIndex = flatLessons.findIndex((row) => row.id === lessonId);
  const previousLesson = currentIndex > 0 ? flatLessons[currentIndex - 1] : null;
  const nextLesson = currentIndex >= 0 && currentIndex < flatLessons.length - 1 ? flatLessons[currentIndex + 1] : null;
  const currentModule = course?.modules.find((module) => module.lessons.some((row) => row.id === lessonId)) ?? null;

  const isAuthor = user?.id === course?.author?.id;
  const canEdit = isAuthor || canUpdateAny;
  const isPreview = course?.status !== "PUBLISHED" && canEdit;
  const isCompleted = progress?.completed_lesson_ids.includes(lessonId) ?? false;

  async function handleMarkComplete() {
    setIsCompleting(true);
    setError(null);
    try {
      await completeLesson(lessonId);
      if (course) setProgress(await getCourseProgress(course.id));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setIsCompleting(false);
    }
  }

  async function handleEnroll() {
    if (!course) return;
    setIsEnrolling(true);
    setError(null);
    try {
      await enrollInCourse(course.id);
      setProgress(await getCourseProgress(course.id));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setIsEnrolling(false);
    }
  }

  if (notFound) {
    return <p className="font-body-md text-body-md text-error">{t("notFound")}</p>;
  }
  if (!course) {
    return <CourseLearnPageSkeleton />;
  }

  const supplementaryResources = lesson
    ? lesson.resources.filter(
        (resource) => !(resource.is_primary && RESOURCE_TYPES_RENDERED_INLINE.has(lesson.lesson_type)),
      )
    : [];

  return (
    <div className="flex flex-col lg:flex-row gap-8 items-start w-full">
      {/* Responsive: expanded sidebar at lg/xl+, collapses out of flow below it */}
      <aside className="hidden lg:block w-80 xl:w-[380px] shrink-0 sticky top-6 bg-surface-container-low border border-outline-variant rounded-2xl p-4 sm:p-5 max-h-[calc(100vh-6rem)] overflow-y-auto space-y-4 shadow-xs">
        <div className="space-y-2 pb-3 border-b border-outline-variant">
          <Link
            href={`/training/courses/${course.id}`}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-on-surface-variant hover:text-primary transition-colors"
          >
            <Icon name="arrow_back" size={14} />
            <span>{t("backToCourse") || "Course Overview"}</span>
          </Link>
          <h2 className="font-headline-md text-headline-md font-bold text-on-surface line-clamp-2">
            {course.title}
          </h2>

          {progress && progress.total_lessons > 0 && (
            <div className="space-y-1.5 pt-1">
              <div className="flex items-center justify-between text-xs text-on-surface-variant font-medium">
                <span>{courseT("progress")}</span>
                <span className="font-semibold text-primary">{Math.round(progress.percent)}%</span>
              </div>
              <div className="w-full h-1.5 bg-surface-container-highest rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all duration-300"
                  style={{ width: `${Math.min(100, Math.max(0, progress.percent))}%` }}
                />
              </div>
              <div className="text-[11px] text-on-surface-variant text-right">
                {courseT("progressLabel", { completed: progress.completed_lessons, total: progress.total_lessons })}
              </div>
            </div>
          )}
        </div>

        <CurriculumList
          courseId={course.id}
          modules={course.modules}
          completedLessonIds={new Set(progress?.completed_lesson_ids ?? [])}
          activeLessonId={lessonId}
          variant="sidebar"
        />
      </aside>

      <div className="flex-1 w-full min-w-0 max-w-5xl space-y-6">
        {!lesson ? (
          <div className="space-y-6 animate-pulse" aria-busy="true">
            <div className="h-4 w-48 bg-surface-container-high rounded-md" />
            <div className="h-9 w-3/4 bg-surface-container-high rounded-lg" />
            <div className="w-full aspect-video min-h-[320px] bg-surface-container-high rounded-2xl" />
            <div className="space-y-3 pt-3">
              <div className="h-4 w-full bg-surface-container-high rounded-md" />
              <div className="h-4 w-5/6 bg-surface-container-high rounded-md" />
            </div>
          </div>
        ) : (
          <>
            {isPreview && (
          <div className="flex items-center justify-between gap-2 bg-tertiary-container text-on-tertiary-container rounded-xl px-4 py-3 font-body-md text-body-md">
            <span className="flex items-center gap-2">
              <Icon name="visibility" size={18} />
              {t("previewBanner")}
            </span>
            <Link
              href={`/training/manage/courses/${course.id}/lessons/${lesson.id}`}
              className="flex items-center gap-1 font-label-caps text-label-caps uppercase hover:underline shrink-0"
            >
              <Icon name="edit" size={16} />
              {t("editLessonLink")}
            </Link>
          </div>
        )}

        <div className="font-label-caps text-label-caps uppercase text-on-surface-variant flex items-center gap-2">
          <Link href={`/training/courses/${course.id}`} className="hover:text-primary transition-colors">
            {course.title}
          </Link>
          {currentModule && (
            <>
              <Icon name="chevron_right" size={14} />
              {currentModule.title}
            </>
          )}
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <h1 className="font-display text-display text-on-surface">{lesson.title}</h1>
            {!lesson.is_required && (
              <span className="font-label-caps text-label-caps uppercase text-on-surface-variant border border-outline-variant rounded-full px-2.5 py-1">
                {t("optionalBadge")}
              </span>
            )}
          </div>
          {lesson.short_description && (
            <p className="font-body-md text-body-md text-on-surface-variant">{lesson.short_description}</p>
          )}
        </div>

        <LessonContent lesson={lesson} />

        {lesson.objectives.length > 0 && (
          <div className="space-y-2">
            <h3 className="font-headline-md text-headline-md text-on-surface">{t("objectivesTitle")}</h3>
            <ul className="space-y-1 list-disc list-inside">
              {lesson.objectives.map((objective) => (
                <li key={objective.id} className="font-body-md text-body-md text-on-surface-variant">
                  {objective.text}
                </li>
              ))}
            </ul>
          </div>
        )}

        <LessonResourceList resources={supplementaryResources} />

        <RelatedKnowledgePanel lessonId={lesson.id} canEdit={canEdit} />

        {error && (
          <p className="font-body-md text-body-md text-error" role="alert">
            {error}
          </p>
        )}

        {/* Below sm the middle action takes its own full-width row on top (order-first) with
            Previous/Next sharing the row beneath - all three side by side overflows a phone. */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-6 border-t border-outline-variant">
          {previousLesson ? (
            <Link href={`/training/courses/${course.id}/learn/${previousLesson.id}`} scroll={false}>
              <Button variant="secondary">
                <Icon name="arrow_back" size={18} />
                {t("previous")}
              </Button>
            </Link>
          ) : (
            <span />
          )}

          {progress?.enrolled ? (
            isCompleted ? (
              <span className="order-first sm:order-none w-full sm:w-auto flex items-center justify-center gap-1 font-label-caps text-label-caps uppercase text-primary">
                <Icon name="check_circle" size={18} />
                {t("completedLabel")}
              </span>
            ) : (
              <Button
                onClick={handleMarkComplete}
                disabled={isCompleting}
                className="order-first sm:order-none w-full sm:w-auto"
              >
                {t("markComplete")}
              </Button>
            )
          ) : !isPreview ? (
            <div className="order-first sm:order-none w-full sm:w-auto flex flex-col sm:flex-row items-center gap-3 text-center sm:text-start">
              <span className="font-body-md text-body-md text-on-surface-variant">{t("enrollToTrack")}</span>
              <Button onClick={handleEnroll} disabled={isEnrolling} className="w-full sm:w-auto">
                {isEnrolling ? courseT("enrolling") : courseT("startCourseButton")}
              </Button>
            </div>
          ) : null}

          {nextLesson ? (
            <Link href={`/training/courses/${course.id}/learn/${nextLesson.id}`} scroll={false}>
              <Button variant="secondary">
                {t("next")}
                <Icon name="arrow_forward" size={18} />
              </Button>
            </Link>
          ) : (
            <span />
          )}
        </div>
        </>
        )}
      </div>
    </div>
  );
}
