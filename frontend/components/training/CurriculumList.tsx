import { useTranslations } from "next-intl";

import { Icon } from "@/components/ui/Icon";
import { Link } from "@/i18n/navigation";
import type { CourseModule, LessonType } from "@/lib/api/types";

interface CurriculumListProps {
  courseId: string;
  modules: CourseModule[];
  /** Omitted entirely (not enrolled) - every lesson then just renders the plain unchecked marker. */
  completedLessonIds?: Set<string>;
  activeLessonId?: string;
}

const LESSON_TYPE_ICON: Record<LessonType, string> = {
  TEXT: "menu_book",
  VIDEO: "play_circle",
  DOCUMENT: "description",
  EXTERNAL: "link",
  EXERCISE: "science",
};

// ✓/→/○ per the spec's curriculum sketch - 🔒 (locking) is FUTURE (see the
// Training Center plan's §1.4/§23): V1 always shows every published lesson
// as reachable, completion-state markers only.
export function CurriculumList({ courseId, modules, completedLessonIds, activeLessonId }: CurriculumListProps) {
  const t = useTranslations("training.course");
  const lessonTypeT = useTranslations("training.lessonType");

  return (
    <div className="space-y-4">
      {modules.map((module) => (
        <div key={module.id}>
          <h4 className="font-label-caps text-label-caps text-on-surface-variant uppercase mb-1.5">{module.title}</h4>
          <ul className="space-y-1.5">
            {module.lessons.map((lesson) => {
              const isCompleted = completedLessonIds?.has(lesson.id) ?? false;
              const isActive = lesson.id === activeLessonId;
              return (
                <li key={lesson.id}>
                  {/* Bordered "card" at rest (not just plain text that only
                      reacts on hover) so it reads as clickable at a glance -
                      hover deepens the border/background and reveals the
                      chevron as an extra "go here" affordance. */}
                  <Link
                    href={`/training/courses/${courseId}/learn/${lesson.id}`}
                    className={`group flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-colors ${
                      isActive
                        ? "bg-primary-container border-primary-container text-on-primary-container"
                        : "bg-surface border-outline-variant hover:border-primary hover:bg-surface-variant"
                    }`}
                  >
                    <Icon
                      name={isCompleted ? "check_circle" : "radio_button_unchecked"}
                      size={18}
                      className={`shrink-0 ${isCompleted ? "text-primary" : isActive ? "text-on-primary-container/70" : "text-on-surface-variant"}`}
                    />
                    <span className="flex-1 min-w-0">
                      <span className={`block truncate font-body-md text-body-md ${isActive ? "font-bold" : "text-on-surface"}`}>
                        {lesson.title}
                      </span>
                      <span
                        className={`flex items-center gap-1 font-label-caps text-label-caps uppercase ${
                          isActive ? "text-on-primary-container/70" : "text-on-surface-variant"
                        }`}
                      >
                        <Icon name={LESSON_TYPE_ICON[lesson.lesson_type]} size={12} />
                        {lessonTypeT(lesson.lesson_type)}
                        {!lesson.is_required && <>&nbsp;&middot; {t("optionalLabel")}</>}
                      </span>
                    </span>
                    <Icon
                      name="chevron_right"
                      size={16}
                      className={`shrink-0 transition-opacity ${
                        isActive ? "opacity-100 text-on-primary-container" : "opacity-0 group-hover:opacity-100 text-on-surface-variant"
                      }`}
                    />
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
