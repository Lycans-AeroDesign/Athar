import { useTranslations } from "next-intl";

import type { QuestionStatus } from "@/lib/api/types";

const STATUS_CLASSES: Record<QuestionStatus, string> = {
  OPEN: "bg-surface-variant text-on-surface-variant",
  ANSWERED: "bg-tertiary-container text-on-tertiary-container",
  SOLVED: "bg-primary-container text-on-primary-container",
  CLOSED: "bg-error-container text-on-error-container",
};

export function QuestionStatusPill({ status }: { status: QuestionStatus }) {
  const t = useTranslations("knowledge.questionStatus");
  const labelKey = {
    OPEN: "open",
    ANSWERED: "answered",
    SOLVED: "solved",
    CLOSED: "closed",
  }[status] as "open" | "answered" | "solved" | "closed";

  return (
    <span
      className={`inline-flex items-center font-label-caps text-label-caps uppercase rounded-full px-2.5 py-1 ${STATUS_CLASSES[status]}`}
    >
      {t(labelKey)}
    </span>
  );
}
