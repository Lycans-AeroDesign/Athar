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
import { Link } from "@/i18n/navigation";
import { completeLesson, enrollInCourse, getCourse, getCourseProgress, getLesson } from "@/lib/api/training";
import type { CourseDetail, CourseProgress, LessonDetail, LessonSummary } from "@/lib/api/types";
import { useAuth } from "@/lib/auth/AuthProvider";
import { useHasPermission } from "@/lib/auth/permissions";

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
      setError(err instanceof Error ? err.message : String(err));
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
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsEnrolling(false);
    }
  }

  if (notFound) {
    return <p className="font-body-md text-body-md text-error">{t("notFound")}</p>;
  }
  if (!course || !lesson) {
    return <p className="font-body-md text-body-md text-on-surface-variant">{t("loading")}</p>;
  }

  const supplementaryResources = lesson.resources.filter(
    (resource) => !(resource.is_primary && RESOURCE_TYPES_RENDERED_INLINE.has(lesson.lesson_type)),
  );

  return (
    <div className="flex flex-col lg:flex-row gap-8 items-start">
      {/* Responsive: full sidebar at lg+, collapses out of flow below it - the
          curriculum stays reachable via the "back to course" breadcrumb link
          instead of a drawer, keeping this screen's mobile complexity down. */}
      <aside className="hidden lg:block w-72 shrink-0 sticky top-6 bg-surface-container-low border border-outline-variant rounded-xl p-4 max-h-[80vh] overflow-y-auto">
        <Link
          href={`/training/courses/${course.id}`}
          className="font-headline-md text-headline-md text-on-surface hover:text-primary transition-colors block mb-3"
        >
          {course.title}
        </Link>
        <CurriculumList
          courseId={course.id}
          modules={course.modules}
          completedLessonIds={new Set(progress?.completed_lesson_ids ?? [])}
          activeLessonId={lesson.id}
        />
      </aside>

      <div className="flex-1 min-w-0 max-w-[760px] space-y-6">
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
            <Link href={`/training/courses/${course.id}/learn/${previousLesson.id}`}>
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
            <Link href={`/training/courses/${course.id}/learn/${nextLesson.id}`}>
              <Button variant="secondary">
                {t("next")}
                <Icon name="arrow_forward" size={18} />
              </Button>
            </Link>
          ) : (
            <span />
          )}
        </div>
      </div>
    </div>
  );
}
