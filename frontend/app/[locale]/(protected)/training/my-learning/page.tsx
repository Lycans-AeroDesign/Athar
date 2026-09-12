"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { CourseCard } from "@/components/training/CourseCard";
import { Button } from "@/components/ui/Button";
import { Link } from "@/i18n/navigation";
import { getCourseProgress, listMyCourses } from "@/lib/api/training";
import type { CourseEnrollment } from "@/lib/api/types";

export default function MyLearningPage() {
  const t = useTranslations("training.myLearning");
  const [inProgress, setInProgress] = useState<CourseEnrollment[] | null>(null);
  const [completed, setCompleted] = useState<CourseEnrollment[] | null>(null);
  const [progressById, setProgressById] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onError = (err: unknown) => setError(err instanceof Error ? err.message : String(err));
    listMyCourses("in_progress").then(setInProgress, onError);
    listMyCourses("completed").then(setCompleted, onError);
  }, []);

  useEffect(() => {
    if (!inProgress) return;
    Promise.all(
      inProgress.map((enrollment) =>
        getCourseProgress(enrollment.course.id).then((progress) => [enrollment.course.id, progress.percent] as const),
      ),
    ).then((entries) => setProgressById(Object.fromEntries(entries)));
  }, [inProgress]);

  return (
    <div className="space-y-8">
      <h1 className="font-display text-display text-on-surface border-b border-outline-variant pb-8">{t("title")}</h1>

      {error && (
        <p className="font-body-md text-body-md text-error" role="alert">
          {error}
        </p>
      )}

      <div className="space-y-3">
        <h2 className="font-headline-md text-headline-md text-on-surface">{t("inProgressTitle")}</h2>
        {inProgress === null ? (
          <p className="font-body-md text-body-md text-on-surface-variant">{t("loading")}</p>
        ) : inProgress.length === 0 ? (
          <div className="space-y-3">
            <p className="font-body-md text-body-md text-on-surface-variant">{t("emptyInProgress")}</p>
            <Link href="/training">
              <Button variant="secondary">{t("browseCourses")}</Button>
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {inProgress.map((enrollment) => (
              <CourseCard key={enrollment.id} course={enrollment.course} progressPercent={progressById[enrollment.course.id]} />
            ))}
          </div>
        )}
      </div>

      <div className="space-y-3">
        <h2 className="font-headline-md text-headline-md text-on-surface">{t("completedTitle")}</h2>
        {completed === null ? (
          <p className="font-body-md text-body-md text-on-surface-variant">{t("loading")}</p>
        ) : completed.length === 0 ? (
          <p className="font-body-md text-body-md text-on-surface-variant">{t("emptyCompleted")}</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {completed.map((enrollment) => (
              <CourseCard key={enrollment.id} course={enrollment.course} progressPercent={100} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
