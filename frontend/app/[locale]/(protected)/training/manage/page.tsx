"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Can } from "@/components/auth/Can";
import { CourseCategoryManager } from "@/components/training/CourseCategoryManager";
import { COURSE_STATUS_LABEL_KEYS, CourseStatusPill } from "@/components/training/CourseStatusPill";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Icon } from "@/components/ui/Icon";
import { ListSkeleton } from "@/components/ui/Skeleton";
import { StatCard } from "@/components/ui/StatCard";
import { Link } from "@/i18n/navigation";
import { getTrainingStats, listCourses } from "@/lib/api/training";
import type { CourseStatus, CourseSummary, TrainingStats } from "@/lib/api/types";
import { useHasPermission } from "@/lib/auth/permissions";
import { formatDate, formatRelativeTime } from "@/lib/datetime";
import { errorMessage } from "@/lib/errors";
import { formatPersonName } from "@/lib/format";
import { PUBLISH_STATUS_ICONS } from "@/lib/optionIcons";

// IN_REVIEW is shown in its own highlighted panel above the tabs, so the tabs
// cover everything else.
type CourseTab = "PUBLISHED" | "DRAFT" | "REJECTED" | "ARCHIVED";
const TABS: CourseTab[] = ["PUBLISHED", "DRAFT", "REJECTED", "ARCHIVED"];
const FETCHED_STATUSES: CourseStatus[] = ["IN_REVIEW", ...TABS];

type CoursesByStatus = Record<CourseStatus, CourseSummary[]>;

export default function TrainingManageDashboardPage() {
  const t = useTranslations("training.manage");
  const statusT = useTranslations("training.status");
  const canManage = useHasPermission("training.manage");
  const canReview = useHasPermission("training.review");
  const canPublish = useHasPermission("training.publish");
  const isReviewer = canReview || canPublish;

  const [stats, setStats] = useState<TrainingStats | null>(null);
  const [courses, setCourses] = useState<CoursesByStatus | null>(null);
  const [tab, setTab] = useState<CourseTab>("PUBLISHED");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (canManage) getTrainingStats().then(setStats, (err) => setError(errorMessage(err)));
  }, [canManage]);

  useEffect(() => {
    // One request per state: the backend scopes non-published states to the
    // viewer's own courses unless they can review/publish, so authors see
    // their own submissions here and reviewers see the whole queue.
    Promise.all(FETCHED_STATUSES.map((status) => listCourses({ status, pageSize: 100 }))).then(
      (results) =>
        setCourses(
          Object.fromEntries(FETCHED_STATUSES.map((status, i) => [status, results[i]])) as CoursesByStatus,
        ),
      (err) => setError(errorMessage(err)),
    );
  }, []);

  const pending = courses?.IN_REVIEW ?? null;
  const tabCourses = courses?.[tab] ?? null;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-outline-variant pb-8">
        <div className="flex items-center gap-3">
          <Link
            href="/training"
            className="inline-flex items-center text-on-surface-variant hover:text-on-surface transition-colors"
          >
            <Icon name="arrow_back" size={20} className="rtl:rotate-180" />
          </Link>
          <h1 className="font-display text-display text-on-surface">{t("dashboardTitle")}</h1>
        </div>
        <Can permission="training.create">
          <Link href="/training/manage/courses/new">
            <Button>
              <Icon name="add" size={18} />
              {t("createCourseButton")}
            </Button>
          </Link>
        </Can>
      </div>

      {error && (
        <p className="font-body-md text-body-md text-error" role="alert">
          {error}
        </p>
      )}

      {canManage && stats && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatCard label={t("totalLearners")} value={stats.total_learners} icon="group" />
          <StatCard label={t("activeLearners")} value={stats.active_learners} icon="trending_up" />
          <StatCard label={t("completedLearners")} value={stats.completed_learners} icon="check_circle" />
        </div>
      )}

      {/* Pending approval */}
      <section className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <h2 className="flex items-center gap-2 font-headline-md text-headline-md text-on-surface">
              <Icon name="hourglass" size={20} className="text-callout-warning" />
              {t("pendingReviewTitle")}
              {pending && pending.length > 0 && (
                <span className="inline-flex items-center justify-center min-w-6 h-6 px-2 rounded-full bg-callout-warning/15 text-callout-warning ring-1 ring-inset ring-callout-warning/40 font-label-caps text-label-caps">
                  {pending.length}
                </span>
              )}
            </h2>
            <p className="font-body-md text-body-md text-on-surface-variant">
              {isReviewer ? t("pendingReviewDescriptionReviewer") : t("pendingReviewDescriptionAuthor")}
            </p>
          </div>
        </div>

        {pending === null ? (
          <ListSkeleton rows={2} compact />
        ) : pending.length === 0 ? (
          <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-dashed border-outline-variant bg-surface-container-low">
            <Icon name="check_circle" size={18} className="text-on-surface-variant" />
            <span className="font-body-md text-body-md text-on-surface-variant">{t("noPendingReview")}</span>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {pending.map((course) => (
              <PendingCourseCard key={course.id} course={course} isReviewer={isReviewer} />
            ))}
          </div>
        )}
      </section>

      {/* All other states */}
      <section className="space-y-4">
        <h2 className="font-headline-md text-headline-md text-on-surface">{t("myCoursesTitle")}</h2>

        <div role="tablist" className="flex flex-wrap gap-1 border-b border-outline-variant">
          {TABS.map((value) => {
            const active = value === tab;
            const count = courses?.[value].length;
            return (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setTab(value)}
                className={`-mb-px inline-flex items-center gap-2 px-4 py-2.5 border-b-2 font-body-md text-body-md transition-colors ${
                  active
                    ? "border-primary text-on-surface"
                    : "border-transparent text-on-surface-variant hover:text-on-surface"
                }`}
              >
                <Icon
                  name={PUBLISH_STATUS_ICONS[value].icon}
                  size={16}
                  className={PUBLISH_STATUS_ICONS[value].iconClassName}
                />
                {statusT(COURSE_STATUS_LABEL_KEYS[value])}
                {count !== undefined && (
                  <span
                    className={`font-mono-sm text-mono-sm rounded-full px-2 ${
                      active ? "bg-primary-container text-on-primary-container" : "bg-surface-variant text-on-surface-variant"
                    }`}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {tabCourses === null ? (
          <ListSkeleton rows={4} compact />
        ) : tabCourses.length === 0 ? (
          <EmptyState
            icon={PUBLISH_STATUS_ICONS[tab].icon}
            message={t("noCoursesInTab", { status: statusT(COURSE_STATUS_LABEL_KEYS[tab]) })}
          />
        ) : (
          <div className="divide-y divide-outline-variant border border-outline-variant rounded-xl overflow-hidden">
            {tabCourses.map((course) => (
              <CourseRow key={course.id} course={course} />
            ))}
          </div>
        )}
      </section>

      {canManage && stats && stats.most_popular_courses.length > 0 && (
        <div className="bg-surface-container-low border border-outline-variant rounded-xl p-4 space-y-2">
          <h3 className="font-label-caps text-label-caps text-on-surface-variant uppercase">{t("mostPopularTitle")}</h3>
          <ul className="space-y-1">
            {stats.most_popular_courses.map((course) => (
              <li key={course.id} className="flex items-center justify-between gap-2">
                <Link
                  href={`/training/courses/${course.id}`}
                  className="font-body-md text-body-md text-on-surface hover:text-primary transition-colors"
                >
                  {course.title}
                </Link>
                <span className="font-mono-sm text-mono-sm text-on-surface-variant">{course.enrolled}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Can permission="training.manage">
        <CourseCategoryManager />
      </Can>
    </div>
  );
}

function CourseMeta({ course }: { course: CourseSummary }) {
  const t = useTranslations("training.manage");
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono-sm text-mono-sm text-on-surface-variant">
      {course.category && (
        <span className="inline-flex items-center gap-1">
          <Icon name="label" size={14} />
          {course.category.name}
        </span>
      )}
      <span className="inline-flex items-center gap-1">
        <Icon name="menu_book" size={14} />
        {t("lessonCount", { count: course.lesson_count })}
      </span>
      <span className="inline-flex items-center gap-1">
        <Icon name="group" size={14} />
        {t("enrolledCount", { count: course.enrollment_count })}
      </span>
    </div>
  );
}

function PendingCourseCard({ course, isReviewer }: { course: CourseSummary; isReviewer: boolean }) {
  const t = useTranslations("training.manage");
  const authorName = formatPersonName(course.author);

  return (
    <Link
      href={`/training/manage/courses/${course.id}`}
      className="group flex flex-col gap-3 p-4 rounded-xl border border-callout-warning/30 border-s-4 border-s-callout-warning bg-callout-warning/5 hover:bg-callout-warning/10 transition-colors"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h3 className="font-body-lg text-body-lg font-semibold text-on-surface truncate group-hover:text-primary transition-colors">
            {course.title}
          </h3>
          {course.short_description && (
            <p className="font-body-md text-body-md text-on-surface-variant line-clamp-2">{course.short_description}</p>
          )}
        </div>
        <CourseStatusPill status={course.status} />
      </div>
      <CourseMeta course={course} />
      <div className="flex items-center justify-between gap-3 pt-2 border-t border-outline-variant">
        <div className="flex items-center gap-2 min-w-0">
          <Avatar person={course.author} size="sm" />
          <div className="min-w-0">
            {authorName && (
              <div className="font-body-md text-body-md text-on-surface truncate">{authorName}</div>
            )}
            <div className="font-mono-sm text-mono-sm text-on-surface-variant">
              {t("submittedAgo", { time: formatRelativeTime(course.updated_at) })}
            </div>
          </div>
        </div>
        <span className="inline-flex items-center gap-1 font-body-md text-body-md text-primary shrink-0">
          {isReviewer ? t("reviewButton") : t("viewButton")}
          <Icon name="arrow_forward" size={16} className="rtl:rotate-180" />
        </span>
      </div>
    </Link>
  );
}

function CourseRow({ course }: { course: CourseSummary }) {
  const t = useTranslations("training.manage");
  const authorName = formatPersonName(course.author);
  const dateLabel =
    course.status === "PUBLISHED" && course.published_at
      ? t("publishedOn", { date: formatDate(course.published_at) })
      : t("updatedAgo", { time: formatRelativeTime(course.updated_at) });

  return (
    <Link
      href={`/training/manage/courses/${course.id}`}
      className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-3 bg-surface-container-low hover:bg-surface-variant transition-colors"
    >
      <div className="flex items-center gap-3 min-w-0">
        <Avatar person={course.author} size="sm" />
        <div className="min-w-0 space-y-1">
          <div className="font-body-md text-body-md text-on-surface truncate">{course.title}</div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <CourseMeta course={course} />
            {authorName && (
              <span className="font-mono-sm text-mono-sm text-on-surface-variant truncate">
                {t("byAuthor", { name: authorName })}
              </span>
            )}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <span className="font-mono-sm text-mono-sm text-on-surface-variant">{dateLabel}</span>
        <CourseStatusPill status={course.status} />
      </div>
    </Link>
  );
}

