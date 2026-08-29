import { useTranslations } from "next-intl";

import type { ArticleStatus } from "@/lib/api/types";

const STATUS_CLASSES: Record<ArticleStatus, string> = {
  DRAFT: "bg-surface-variant text-on-surface-variant",
  IN_REVIEW: "bg-tertiary-container text-on-tertiary-container",
  PUBLISHED: "bg-primary-container text-on-primary-container",
  REJECTED: "bg-error-container text-on-error-container",
  ARCHIVED: "bg-surface-variant text-on-surface-variant",
};

export function StatusPill({ status }: { status: ArticleStatus }) {
  const t = useTranslations("knowledge.status");
  const labelKey = {
    DRAFT: "draft",
    IN_REVIEW: "inReview",
    PUBLISHED: "published",
    REJECTED: "rejected",
    ARCHIVED: "archived",
  }[status] as "draft" | "inReview" | "published" | "rejected" | "archived";

  return (
    <span
      className={`inline-flex items-center font-label-caps text-label-caps uppercase rounded-full px-2.5 py-1 ${STATUS_CLASSES[status]}`}
    >
      {t(labelKey)}
    </span>
  );
}
