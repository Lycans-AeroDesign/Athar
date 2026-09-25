"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Can } from "@/components/auth/Can";
import { CourseCategoryManager } from "@/components/training/CourseCategoryManager";
import { COURSE_STATUS_LABEL_KEYS, CourseStatusPill } from "@/components/training/CourseStatusPill";
import { Button } from "@/components/ui/Button";
import { Combobox } from "@/components/ui/Combobox";
import { Icon } from "@/components/ui/Icon";
import { StatCard } from "@/components/ui/StatCard";
import { Link } from "@/i18n/navigation";
import { getTrainingStats, listCourses } from "@/lib/api/training";
import type { CourseStatus, CourseStatusFilter, CourseSummary, TrainingStats } from "@/lib/api/types";
import { useHasPermission } from "@/lib/auth/permissions";
import { PUBLISH_STATUS_ICONS } from "@/lib/optionIcons";

const STATUS_FILTERS: CourseStatusFilter[] = ["ALL", "DRAFT", "IN_REVIEW", "PUBLISHED", "REJECTED", "ARCHIVED"];

export default function TrainingManageDashboardPage() {
  const t = useTranslations("training.manage");
  const statusT = useTranslations("training.status");
  const canManage = useHasPermission("training.manage");

  const [stats, setStats] = useState<TrainingStats | null>(null);
  const [courses, setCourses] = useState<CourseSummary[] | null>(null);
  const [statusFilter, setStatusFilter] = useState<CourseStatusFilter>("ALL");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (canManage) getTrainingStats().then(setStats, (err) => setError(err instanceof Error ? err.message : String(err)));
  }, [canManage]);

  useEffect(() => {
    listCourses({ status: statusFilter }).then(setCourses, (err) => setError(err instanceof Error ? err.message : String(err)));
  }, [statusFilter]);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-outline-variant pb-8">
        <div className="flex items-center gap-3">
          <Link
            href="/training"
            className="inline-flex items-center text-on-surface-variant hover:text-on-surface transition-colors"
          >
            <Icon name="arrow_back" size={20} />
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
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
            {Object.entries(stats.courses_by_status).map(([status, count]) => (
              <StatCard
                key={status}
                label={statusT(COURSE_STATUS_LABEL_KEYS[status as CourseStatus])}
                value={count}
                icon="school"
              />
            ))}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <StatCard label={t("totalLearners")} value={stats.total_learners} icon="group" />
            <StatCard label={t("activeLearners")} value={stats.active_learners} icon="trending_up" />
            <StatCard label={t("completedLearners")} value={stats.completed_learners} icon="check_circle" />
          </div>
          {stats.most_popular_courses.length > 0 && (
            <div className="bg-surface-container-low border border-outline-variant rounded-xl p-4 space-y-2">
              <h3 className="font-label-caps text-label-caps text-on-surface-variant uppercase">{t("mostPopularTitle")}</h3>
              <ul className="space-y-1">
                {stats.most_popular_courses.map((course) => (
                  <li key={course.id} className="flex items-center justify-between gap-2">
                    <Link href={`/training/courses/${course.id}`} className="font-body-md text-body-md text-on-surface hover:text-primary transition-colors">
                      {course.title}
                    </Link>
                    <span className="font-mono-sm text-mono-sm text-on-surface-variant">{course.enrolled}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-headline-md text-headline-md text-on-surface">{t("myCoursesTitle")}</h2>
          <div className="w-48">
            <Combobox
              options={STATUS_FILTERS.map((value) => ({
                value,
                label: value === "ALL" ? t("statusFilterAll") : statusT(COURSE_STATUS_LABEL_KEYS[value]),
                ...(value === "ALL" ? {} : PUBLISH_STATUS_ICONS[value]),
              }))}
              value={statusFilter}
              onChange={(value) => setStatusFilter(value as CourseStatusFilter)}
            />
          </div>
        </div>
        {courses === null ? (
          <p className="font-body-md text-body-md text-on-surface-variant">{t("loading")}</p>
        ) : (
          <div className="divide-y divide-outline-variant border border-outline-variant rounded-xl overflow-hidden">
            {courses.map((course) => (
              <Link
                key={course.id}
                href={`/training/manage/courses/${course.id}`}
                className="flex items-center justify-between gap-3 px-4 py-3 bg-surface-container-low hover:bg-surface-variant transition-colors"
              >
                <span className="font-body-md text-body-md text-on-surface">{course.title}</span>
                <div className="flex items-center gap-3">
                  <span className="font-mono-sm text-mono-sm text-on-surface-variant">
                    {course.enrollment_count}
                  </span>
                  <CourseStatusPill status={course.status} />
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      <Can permission="training.manage">
        <CourseCategoryManager />
      </Can>
    </div>
  );
}
