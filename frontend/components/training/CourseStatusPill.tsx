import { useTranslations } from "next-intl";

import type { CourseStatus } from "@/lib/api/types";

const STATUS_CLASSES: Record<CourseStatus, string> = {
  DRAFT: "bg-surface-variant text-on-surface-variant",
  IN_REVIEW: "bg-tertiary-container text-on-tertiary-container",
  PUBLISHED: "bg-primary-container text-on-primary-container",
  REJECTED: "bg-error-container text-on-error-container",
  ARCHIVED: "bg-surface-variant text-on-surface-variant",
};

export const COURSE_STATUS_LABEL_KEYS: Record<CourseStatus, "draft" | "inReview" | "published" | "rejected" | "archived"> = {
  DRAFT: "draft",
  IN_REVIEW: "inReview",
  PUBLISHED: "published",
  REJECTED: "rejected",
  ARCHIVED: "archived",
};

export function CourseStatusPill({ status }: { status: CourseStatus }) {
  const t = useTranslations("training.status");

  return (
    <span
      className={`inline-flex items-center font-label-caps text-label-caps uppercase rounded-full px-2.5 py-1 ${STATUS_CLASSES[status]}`}
    >
      {t(COURSE_STATUS_LABEL_KEYS[status])}
    </span>
  );
}
