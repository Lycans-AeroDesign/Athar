import { useTranslations } from "next-intl";

import type { CourseDifficulty } from "@/lib/api/types";

// Reuses the app's existing Material-3-style container tokens (no new color
// added) as a rough severity ramp: secondary (calm blue) -> tertiary (amber/
// orange) -> error (red), same escalation CourseStatusPill already uses
// tertiary-container for the "in review, needs attention" status.
const DIFFICULTY_CLASSES: Record<CourseDifficulty, string> = {
  BEGINNER: "bg-secondary-container text-on-secondary-container",
  INTERMEDIATE: "bg-tertiary-container text-on-tertiary-container",
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
