import { useTranslations } from "next-intl";

import { Icon } from "@/components/ui/Icon";
import { Link } from "@/i18n/navigation";
import { formatRelativeTime } from "@/lib/datetime";
import { formatPersonName } from "@/lib/format";
import type { ArticleSummary } from "@/lib/api/types";

import { StatusPill } from "./StatusPill";

export function ArticleCard({ article }: { article: ArticleSummary }) {
  const t = useTranslations("knowledge");
  const authorName = formatPersonName(article.author);

  return (
    <Link
      href={`/knowledge/articles/${article.id}`}
      className="block bg-surface-container-low border border-outline-variant rounded-xl p-4 hover:shadow-[0_1px_3px_0_rgba(0,0,0,0.08)] transition-shadow"
    >
      <div className="flex items-center justify-between mb-2">
        <span className="flex items-center gap-1 font-label-caps text-label-caps uppercase text-on-surface-variant">
          <Icon name="menu_book" size={14} />
          {t("article.badgeLabel")}
        </span>
        <div className="flex items-center gap-2">
          {/* Cards only ever showed published articles before the Knowledge
              page's status filter (see [locale]/(protected)/knowledge/page.tsx)
              - now that a draft/rejected/archived one can appear here too, it
              needs its own status called out. */}
          {article.status !== "PUBLISHED" && <StatusPill status={article.status} />}
          <span className="font-mono-sm text-mono-sm text-on-surface-variant">
            {formatRelativeTime(article.updated_at)}
          </span>
        </div>
      </div>
      <h4 className="font-headline-md text-headline-md text-primary mb-1">{article.title}</h4>
      {article.excerpt && (
        <p className="font-body-md text-body-md text-on-surface-variant line-clamp-2 mb-3">{article.excerpt}</p>
      )}
      {authorName && (
        <div className="pt-3 border-t border-outline-variant font-body-md text-body-md text-on-surface-variant">
          {t("article.byAuthor", { name: authorName })}
        </div>
      )}
    </Link>
  );
}
