import { useTranslations } from "next-intl";

import { AuthenticatedImage } from "@/components/ui/AuthenticatedImage";
import { Icon } from "@/components/ui/Icon";
import { Link } from "@/i18n/navigation";
import { formatPersonName } from "@/lib/format";
import type { CourseSummary } from "@/lib/api/types";

import { CourseStatusPill } from "./CourseStatusPill";

interface CourseCardProps {
  course: CourseSummary;
  /** Caller's own progress percent (0-100) for this course, if enrolled - omitted (undefined) when the viewer isn't enrolled. */
  progressPercent?: number;
}

export function CourseCard({ course, progressPercent }: CourseCardProps) {
  const t = useTranslations("training");
  const authorName = formatPersonName(course.author);

  return (
    <Link
      href={`/training/courses/${course.id}`}
      className="block bg-surface-container-low border border-outline-variant rounded-xl overflow-hidden hover:shadow-[0_1px_3px_0_rgba(0,0,0,0.08)] transition-shadow"
    >
      <div className="h-32 bg-surface-container-high flex items-center justify-center">
        {course.cover_image ? (
          <AuthenticatedImage
            src={course.cover_image.download_url}
            alt=""
            className="h-full w-full object-cover"
            fallback={<Icon name="school" size={40} className="text-on-surface-variant/40" />}
          />
        ) : (
          <Icon name="school" size={40} className="text-on-surface-variant/40" />
        )}
      </div>
      <div className="p-4 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="font-label-caps text-label-caps uppercase text-on-surface-variant">
            {t(`difficulty.${course.difficulty}`)}
          </span>
          {course.status !== "PUBLISHED" && <CourseStatusPill status={course.status} />}
        </div>
        <h4 className="font-headline-md text-headline-md text-primary line-clamp-2">{course.title}</h4>
        {course.short_description && (
          <p className="font-body-md text-body-md text-on-surface-variant line-clamp-2">{course.short_description}</p>
        )}
        <div className="flex flex-wrap items-center gap-3 font-mono-sm text-mono-sm text-on-surface-variant pt-1">
          <span className="flex items-center gap-1">
            <Icon name="folder_open" size={14} />
            {t("card.moduleCount", { count: course.module_count })}
          </span>
          <span className="flex items-center gap-1">
            <Icon name="menu_book" size={14} />
            {t("card.lessonCount", { count: course.lesson_count })}
          </span>
          {course.estimated_minutes > 0 && (
            <span className="flex items-center gap-1">
              <Icon name="schedule" size={14} />
              {t("card.minutes", { count: course.estimated_minutes })}
            </span>
          )}
        </div>
        {authorName && (
          <div className="pt-2 border-t border-outline-variant font-body-md text-body-md text-on-surface-variant">
            {t("course.byAuthor", { name: authorName })}
          </div>
        )}
        {progressPercent !== undefined && (
          <div className="pt-2 space-y-1">
            <div className="h-1.5 w-full rounded-full bg-surface-variant overflow-hidden">
              <div className="h-full bg-primary rounded-full" style={{ width: `${progressPercent}%` }} />
            </div>
            <span className="font-label-caps text-label-caps text-on-surface-variant">
              {t("card.progressLabel", { percent: Math.round(progressPercent) })}
            </span>
          </div>
        )}
      </div>
    </Link>
  );
}
