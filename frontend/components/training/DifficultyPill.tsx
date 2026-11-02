import { useTranslations } from "next-intl";

import type { CourseDifficulty } from "@/lib/api/types";

// Rough severity ramp: secondary (calm blue) -> callout-warning (amber) ->
// error (red). Amber is the same one CourseStatusPill uses for "in review".
const DIFFICULTY_CLASSES: Record<CourseDifficulty, string> = {
  BEGINNER: "bg-secondary-container text-on-secondary-container",
  INTERMEDIATE: "bg-callout-warning/15 text-callout-warning ring-1 ring-inset ring-callout-warning/40",
  ADVANCED: "bg-error-container text-on-error-container",
};

export function DifficultyPill({ difficulty }: { difficulty: CourseDifficulty }) {
  const t = useTranslations("training.difficulty");

  return (
    <span
      className={`inline-flex items-center font-label-caps text-label-caps uppercase rounded-full px-2.5 py-1 ${DIFFICULTY_CLASSES[difficulty]}`}
    >
      {t(difficulty)}
    </span>
  );
}
