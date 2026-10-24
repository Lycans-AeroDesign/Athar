"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { Icon } from "@/components/ui/Icon";
import { Link } from "@/i18n/navigation";
import type { CourseModule } from "@/lib/api/types";
import { LESSON_TYPE_ICONS } from "@/lib/optionIcons";

interface CurriculumListProps {
  courseId: string;
  modules: CourseModule[];
  completedLessonIds?: Set<string>;
  activeLessonId?: string;
  variant?: "sidebar" | "detail";
}

export function CurriculumList({
  courseId,
  modules,
  completedLessonIds,
  activeLessonId,
  variant = "detail",
}: CurriculumListProps) {
  const t = useTranslations("training.course");
  const cardT = useTranslations("training.card");
  const lessonTypeT = useTranslations("training.lessonType");

  const activeLessonRef = useRef<HTMLAnchorElement | null>(null);

  // In sidebar mode, only the chapter containing the active lesson is expanded by default
  const [openModules, setOpenModules] = useState<Record<string, boolean>>(() => {
    if (variant === "sidebar" && activeLessonId) {
      const activeMod = modules.find((m) => m.lessons.some((l) => l.id === activeLessonId));
      if (activeMod) {
        return { [activeMod.id]: true };
      }
    }
    return Object.fromEntries(modules.map((m) => [m.id, true]));
  });

  // Whenever the active lesson changes, collapse other chapters and open the active one
  useEffect(() => {
    if (variant === "sidebar" && activeLessonId) {
      const activeMod = modules.find((m) => m.lessons.some((l) => l.id === activeLessonId));
      if (activeMod) {
        setOpenModules({ [activeMod.id]: true });
      }
    }
  }, [activeLessonId, variant, modules]);

  // Keep focus on the selected lesson in the left sidebar
  useEffect(() => {
    if (variant === "sidebar" && activeLessonRef.current) {
      activeLessonRef.current.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [activeLessonId, variant]);

  function toggleModule(id: string) {
    setOpenModules((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  if (variant === "sidebar") {
    return (
      <div className="space-y-3">
        {modules.map((module, mIdx) => {
          const isOpen = openModules[module.id] ?? true;
          const completedCount = module.lessons.filter((l) =>
            completedLessonIds?.has(l.id),
          ).length;
          const allCompleted =
            module.lessons.length > 0 && completedCount === module.lessons.length;
          const hasActiveLesson = module.lessons.some((l) => l.id === activeLessonId);

          return (
            <div
              key={module.id}
              className={`rounded-xl border transition-colors overflow-hidden ${
                hasActiveLesson
                  ? "border-primary/40 bg-surface-container"
                  : "border-outline-variant bg-surface"
              }`}
            >
              <button
                type="button"
                onClick={() => toggleModule(module.id)}
                className="w-full flex items-center justify-between gap-2.5 p-3 text-start hover:bg-surface-variant/40 transition-colors cursor-pointer select-none"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="flex h-5 w-5 items-center justify-center rounded-md bg-surface font-mono font-bold text-[11px] text-primary border border-outline-variant shrink-0">
                    {mIdx + 1}
                  </span>
                  <span className="font-body-sm text-body-sm font-semibold text-on-surface line-clamp-1">
                    {module.title}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0 text-on-surface-variant">
                  <span className="text-[11px] font-mono">
                    {completedCount}/{module.lessons.length}
                  </span>
                  {allCompleted && (
                    <Icon name="check_circle" size={13} className="text-primary" />
                  )}
                  <Icon
                    name={isOpen ? "expand_less" : "expand_more"}
                    size={16}
                    className="text-on-surface-variant"
                  />
                </div>
              </button>

              {isOpen && (
                <ul className="p-1.5 pt-0 space-y-1 border-t border-outline-variant/50">
                  {module.lessons.map((lesson) => {
                    const isCompleted = completedLessonIds?.has(lesson.id) ?? false;
                    const isActive = lesson.id === activeLessonId;
                    return (
                      <li key={lesson.id}>
                        <Link
                          ref={isActive ? activeLessonRef : undefined}
                          href={`/training/courses/${courseId}/learn/${lesson.id}`}
                          scroll={false}
                          className={`group flex items-start gap-2.5 px-2.5 py-2 rounded-lg text-start transition-all ${
                            isActive
                              ? "bg-primary text-on-primary shadow-xs font-medium"
                              : isCompleted
                                ? "text-on-surface hover:bg-surface-variant/70"
                                : "text-on-surface-variant hover:text-on-surface hover:bg-surface-variant/50"
                          }`}
                        >
                          <Icon
                            name={isCompleted ? "check_circle" : "radio_button_unchecked"}
                            size={16}
                            className={`mt-0.5 shrink-0 ${
                              isActive
                                ? "text-on-primary"
                                : isCompleted
                                  ? "text-primary"
                                  : "text-on-surface-variant/60"
                            }`}
                          />
                          <div className="flex-1 min-w-0">
                            <span className="block text-xs leading-snug line-clamp-2">
                              {lesson.title}
                            </span>
                            <span
                              className={`flex items-center gap-1 text-[10px] mt-0.5 uppercase tracking-wider ${
                                isActive ? "text-on-primary/80" : "text-on-surface-variant/70"
                              }`}
                            >
                              <Icon name={LESSON_TYPE_ICONS[lesson.lesson_type].icon} size={11} />
                              {lessonTypeT(lesson.lesson_type)}
                              {!lesson.is_required && <span>&middot; {t("optionalLabel")}</span>}
                            </span>
                          </div>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  // Detail / Revamped LMS Layout
  return (
    <div className="space-y-3">
      {modules.map((module, mIdx) => {
        const isOpen = openModules[module.id] ?? true;
        const completedCount = module.lessons.filter((l) =>
          completedLessonIds?.has(l.id),
        ).length;
        const allCompleted =
          module.lessons.length > 0 && completedCount === module.lessons.length;

        return (
          <div
            key={module.id}
            className="rounded-xl border border-outline-variant bg-surface-container-low overflow-hidden transition-all shadow-xs"
          >
            <button
              type="button"
              onClick={() => toggleModule(module.id)}
              className="w-full flex items-center justify-between gap-3 p-4 text-start hover:bg-surface-variant/40 transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-surface font-mono font-bold text-label-sm text-primary border border-outline-variant shrink-0">
                  {mIdx + 1}
                </span>
                <div className="min-w-0">
                  <h3 className="font-headline-md text-headline-md font-bold text-on-surface truncate">
                    {module.title}
                  </h3>
                  {module.description && (
                    <p className="font-body-sm text-body-sm text-on-surface-variant line-clamp-1 mt-0.5">
                      {module.description}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-3 shrink-0">
                <div className="flex items-center gap-2 font-label-caps text-label-caps text-on-surface-variant">
                  <span>{cardT("lessonCount", { count: module.lessons.length })}</span>
                  {module.estimated_minutes > 0 && (
                    <>
                      <span>&middot;</span>
                      <span>{cardT("minutes", { count: module.estimated_minutes })}</span>
                    </>
                  )}
                  {allCompleted && (
                    <span className="flex items-center gap-1 text-primary">
                      <Icon name="check_circle" size={14} />
                    </span>
                  )}
                </div>
                <Icon
                  name="chevron_right"
                  size={18}
                  className={`text-on-surface-variant transition-transform duration-200 ${
                    isOpen ? "rotate-90" : ""
                  }`}
                />
              </div>
            </button>

            {isOpen && (
              <div className="border-t border-outline-variant/60 bg-surface px-2 py-2">
                <ul className="space-y-1">
                  {module.lessons.map((lesson) => {
                    const isCompleted = completedLessonIds?.has(lesson.id) ?? false;
                    return (
                      <li key={lesson.id}>
                        <Link
                          href={`/training/courses/${courseId}/learn/${lesson.id}`}
                          className="group flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg hover:bg-surface-container transition-colors"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <Icon
                              name={isCompleted ? "check_circle" : "play_circle"}
                              size={18}
                              className={`shrink-0 ${
                                isCompleted ? "text-primary" : "text-on-surface-variant group-hover:text-primary transition-colors"
                              }`}
                            />
                            <div className="min-w-0">
                              <span className="block font-body-md text-body-md text-on-surface group-hover:text-primary transition-colors truncate">
                                {lesson.title}
                              </span>
                              <div className="flex items-center gap-2 font-label-caps text-label-caps text-on-surface-variant uppercase mt-0.5">
                                <span className="flex items-center gap-1">
                                  <Icon name={LESSON_TYPE_ICONS[lesson.lesson_type].icon} size={12} />
                                  {lessonTypeT(lesson.lesson_type)}
                                </span>
                                {!lesson.is_required && (
                                  <span>&middot; {t("optionalLabel")}</span>
                                )}
                                {lesson.estimated_minutes > 0 && (
                                  <span>&middot; {cardT("minutes", { count: lesson.estimated_minutes })}</span>
                                )}
                              </div>
                            </div>
                          </div>

                          <Icon
                            name="arrow_forward"
                            size={16}
                            className="text-on-surface-variant opacity-0 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all shrink-0"
                          />
                        </Link>
                      </li>
                    );
                  })}
                  {module.lessons.length === 0 && (
                    <li className="p-3 text-center font-body-sm text-body-sm text-on-surface-variant italic">
                      {t("noLessons") || "No lessons in this module yet."}
                    </li>
                  )}
                </ul>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
