import { useTranslations } from "next-intl";

import type { CourseStatus } from "@/lib/api/types";

const STATUS_CLASSES: Record<CourseStatus, string> = {
  DRAFT: "bg-surface-variant text-on-surface-variant",
  // callout-warning is the theme's amber (#9a6700 light / #d29922 dark) - the
  // old tertiary-container pairing was rust-on-salmon with poor contrast.
  IN_REVIEW: "bg-callout-warning/15 text-callout-warning ring-1 ring-inset ring-callout-warning/40",
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
