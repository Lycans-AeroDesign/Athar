import { useTranslations } from "next-intl";

import { Icon } from "@/components/ui/Icon";
import { Link } from "@/i18n/navigation";
import { formatRelativeTime } from "@/lib/datetime";
import { formatPersonName } from "@/lib/format";
import type { QuestionSummary } from "@/lib/api/types";

export function QuestionCard({ question }: { question: QuestionSummary }) {
  const t = useTranslations("knowledge");
  const authorName = formatPersonName(question.author);

  return (
    <div className="bg-surface-container-low border border-outline-variant rounded-xl p-4 hover:shadow-[0_1px_3px_0_rgba(0,0,0,0.08)] transition-shadow">
      <Link href={`/knowledge/questions/${question.id}`} className="block">
        <div className="flex items-center justify-between mb-2">
          <span className="flex items-center gap-1 font-label-caps text-label-caps uppercase text-on-surface-variant">
            <Icon name="forum" size={14} />
            {t("question.badgeLabel")}
          </span>
          <span className="font-mono-sm text-mono-sm text-on-surface-variant">
            {formatRelativeTime(question.updated_at)}
          </span>
        </div>
        <h4 className="font-headline-md text-headline-md text-primary mb-1">{question.title}</h4>
        <div className="flex items-center gap-2 font-body-md text-body-md text-on-surface-variant mb-3">
          {question.has_accepted_answer && (
            <span className="flex items-center gap-1 text-primary">
              <Icon name="check_circle" size={14} />
            </span>
          )}
          {t("question.answerCount", { count: question.answer_count })}
        </div>
      </Link>
      {/* Outside the question's own <Link> above - see ArticleCard.tsx's
          matching comment for why (nesting a link inside a link is invalid HTML). */}
      {authorName && question.author && (
        <div className="pt-3 border-t border-outline-variant font-body-md text-body-md text-on-surface-variant">
          <Link href={`/users/${question.author.id}`} className="hover:text-primary hover:underline transition-colors">
            {t("article.byAuthor", { name: authorName })}
          </Link>
        </div>
      )}
    </div>
  );
}
