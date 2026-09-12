"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Can } from "@/components/auth/Can";
import { CourseCard } from "@/components/training/CourseCard";
import { Button } from "@/components/ui/Button";
import { Combobox } from "@/components/ui/Combobox";
import { Icon } from "@/components/ui/Icon";
import { Link } from "@/i18n/navigation";
import { getCourseProgress, listCourseCategories, listCourses, listMyCourses, searchCourses } from "@/lib/api/training";
import type { CourseCategory, CourseDifficulty, CourseEnrollment, CourseSummary } from "@/lib/api/types";

const DIFFICULTIES: CourseDifficulty[] = ["BEGINNER", "INTERMEDIATE", "ADVANCED"];

export default function TrainingDiscoveryPage() {
  const t = useTranslations("training.discovery");
  const difficultyT = useTranslations("training.difficulty");

  const [courses, setCourses] = useState<CourseSummary[] | null>(null);
  const [categories, setCategories] = useState<CourseCategory[]>([]);
  const [myEnrollments, setMyEnrollments] = useState<CourseEnrollment[]>([]);
  const [query, setQuery] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [difficulty, setDifficulty] = useState<CourseDifficulty | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onError = (err: unknown) => setError(err instanceof Error ? err.message : String(err));
    listCourseCategories().then(setCategories, onError);
    listMyCourses("in_progress").then(setMyEnrollments, onError);
  }, []);

  useEffect(() => {
    const onError = (err: unknown) => setError(err instanceof Error ? err.message : String(err));
    const trimmed = query.trim();
    const handle = setTimeout(() => {
      if (trimmed) {
        searchCourses(trimmed, categoryId ?? undefined, difficulty ?? undefined).then(
          (data) => setCourses(data.results),
          onError,
        );
      } else {
        listCourses({ category: categoryId ?? undefined, difficulty: difficulty ?? undefined }).then(setCourses, onError);
      }
    }, 300);
    return () => clearTimeout(handle);
  }, [query, categoryId, difficulty]);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-outline-variant pb-8">
        <div>
          <h1 className="font-display text-display text-on-surface">{t("title")}</h1>
          <p className="font-body-md text-body-md text-on-surface-variant">{t("subtitle")}</p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/training/my-learning">
            <Button variant="secondary">
              <Icon name="school" size={18} />
              {t("myLearningLink")}
            </Button>
          </Link>
          <Can permission="training.manage">
            <Link href="/training/manage">
              <Button variant="secondary">
                <Icon name="admin_panel_settings" size={18} />
                {t("manageLink")}
              </Button>
            </Link>
          </Can>
          <Can permission="training.create">
            <Link href="/training/manage/courses/new">
              <Button>
                <Icon name="add" size={18} />
                {t("newCourseButton")}
              </Button>
            </Link>
          </Can>
        </div>
      </div>

      {error && (
        <p className="font-body-md text-body-md text-error" role="alert">
          {error}
        </p>
      )}

      {myEnrollments.length > 0 && (
        <div className="space-y-3">
          <h2 className="font-headline-md text-headline-md text-on-surface">{t("continueLearningTitle")}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {myEnrollments.map((enrollment) => (
              <ContinueLearningCard key={enrollment.id} enrollment={enrollment} />
            ))}
          </div>
        </div>
      )}

      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-headline-md text-headline-md text-on-surface">{t("allCoursesTitle")}</h2>
          <div className="flex flex-wrap items-center gap-3">
            <div className="w-56">
              <input
                className="block w-full px-4 py-2 font-body-md text-body-md text-on-surface bg-surface border border-outline-variant rounded-lg focus:ring-1 focus:ring-primary focus:border-primary outline-none transition-colors"
                placeholder={t("searchPlaceholder")}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <div className="w-48">
              <Combobox
                placeholder={t("categoryAll")}
                options={categories.map((category) => ({ value: category.id, label: category.name }))}
                value={categoryId}
                onChange={setCategoryId}
              />
            </div>
            <div className="w-44">
              <Combobox
                placeholder={t("difficultyAll")}
                options={DIFFICULTIES.map((value) => ({ value, label: difficultyT(value) }))}
                value={difficulty}
                onChange={(value) => setDifficulty(value as CourseDifficulty)}
              />
            </div>
          </div>
        </div>

        {courses === null ? (
          <p className="font-body-md text-body-md text-on-surface-variant">{t("loading")}</p>
        ) : courses.length === 0 ? (
          <p className="font-body-md text-body-md text-on-surface-variant">{t("emptyState")}</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {courses.map((course) => (
              <CourseCard key={course.id} course={course} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ContinueLearningCard({ enrollment }: { enrollment: CourseEnrollment }) {
  // Progress % isn't included in the enrollment payload itself (see
  // CourseEnrollmentSerializer) - a dedicated GET .../progress/ call per
  // enrolled course keeps the shared CourseCard component simple and avoids
  // an expensive per-course aggregate on the plain courses list endpoint.
  const [percent, setPercent] = useState<number | undefined>(undefined);

  useEffect(() => {
    getCourseProgress(enrollment.course.id).then((progress) => setPercent(progress.percent));
  }, [enrollment.course.id]);

  return <CourseCard course={enrollment.course} progressPercent={percent} />;
}
