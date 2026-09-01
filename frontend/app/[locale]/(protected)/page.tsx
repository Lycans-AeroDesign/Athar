"use client";

import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";

import { ArticleCard } from "@/components/knowledge/ArticleCard";
import { QuestionCard } from "@/components/knowledge/QuestionCard";
import { Can } from "@/components/auth/Can";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { StatCard } from "@/components/ui/StatCard";
import { Link } from "@/i18n/navigation";
import { getKnowledgeActivity } from "@/lib/api/audit";
import { getArticleCount, getArticles, getOpenQuestionCount, getQuestions } from "@/lib/api/knowledge";
import type { ArticleSummary, AuditLogEntry, QuestionSummary } from "@/lib/api/types";
import { formatRelativeTime } from "@/lib/datetime";
import { useAuth } from "@/lib/auth/AuthProvider";

// Maps an audit action string (see backend/audit/views.py's
// KNOWLEDGE_ACTIVITY_ACTIONS) to the "activityActions" translation key -
// dots aren't usable inside a translation key path, hence the remap.
const ACTIVITY_ACTION_KEYS: Record<string, string> = {
  "article.publish": "articlePublish",
  "article.submit": "articleSubmit",
  "article.reject": "articleReject",
  "article.archive": "articleArchive",
  "question.create": "questionCreate",
  "question.answer": "questionAnswer",
  "question.accept_answer": "questionAcceptAnswer",
  "question.promote": "questionPromote",
};

const RECENT_ITEMS_LIMIT = 4;

export default function DashboardPage() {
  const { user } = useAuth();
  const t = useTranslations("dashboard");

  const [articleCount, setArticleCount] = useState<number | null>(null);
  const [openQuestionCount, setOpenQuestionCount] = useState<number | null>(null);
  const [articles, setArticles] = useState<ArticleSummary[] | null>(null);
  const [questions, setQuestions] = useState<QuestionSummary[] | null>(null);
  const [activity, setActivity] = useState<AuditLogEntry[] | null>(null);
  // One shared banner for any of the five independent fetches below - each
  // still resolves/renders on its own (a failed activity feed shouldn't block
  // the stat cards), but a silent failure previously meant "Loading..."
  // forever with no explanation.
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const onError = (err: unknown) => setLoadError(err instanceof Error ? err.message : String(err));
    getArticleCount().then(setArticleCount, onError);
    getOpenQuestionCount().then(setOpenQuestionCount, onError);
    getArticles().then(setArticles, onError);
    getQuestions().then(setQuestions, onError);
    getKnowledgeActivity().then((data) => setActivity(data.results), onError);
  }, []);

  const recentItems = useMemo(() => {
    if (!articles || !questions) return null;
    const items: Array<{ type: "article"; data: ArticleSummary } | { type: "question"; data: QuestionSummary }> = [
      ...articles.map((data) => ({ type: "article" as const, data })),
      ...questions.map((data) => ({ type: "question" as const, data })),
    ];
    return items.sort((a, b) => (a.data.updated_at < b.data.updated_at ? 1 : -1)).slice(0, RECENT_ITEMS_LIMIT);
  }, [articles, questions]);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-display text-on-surface">
            {user ? t("welcomeWithName", { name: user.email }) : t("welcome")}
          </h1>
          <p className="font-body-lg text-body-lg text-on-surface-variant mt-2">{t("subtitle")}</p>
        </div>
        <div className="flex items-center gap-3">
          <Can permission="question.create">
            <Link href="/knowledge/questions/new">
              <Button variant="secondary">
                <Icon name="forum" size={18} />
                {t("askQuestionButton")}
              </Button>
            </Link>
          </Can>
          <Can permission="article.create">
            <Link href="/knowledge/articles/new">
              <Button>
                <Icon name="add" size={18} />
                {t("newArticleButton")}
              </Button>
            </Link>
          </Can>
        </div>
      </div>

      {loadError && (
        <p className="font-body-md text-body-md text-error" role="alert">
          {loadError}
        </p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <StatCard label={t("statArticlesLabel")} value={articleCount ?? "..."} icon="menu_book" />
        <StatCard label={t("statQuestionsLabel")} value={openQuestionCount ?? "..."} icon="forum" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-8 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-headline-md text-headline-md text-on-surface">{t("recentlyUpdatedTitle")}</h2>
            <Link href="/knowledge" className="font-label-caps text-label-caps uppercase text-primary">
              {t("viewAllLink")}
            </Link>
          </div>

          {recentItems === null ? (
            <p className="font-body-md text-body-md text-on-surface-variant">{t("activityLoading")}</p>
          ) : recentItems.length === 0 ? (
            <p className="font-body-md text-body-md text-on-surface-variant">{t("recentEmptyState")}</p>
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              {recentItems.map((item) =>
                item.type === "article" ? (
                  <ArticleCard key={`article-${item.data.id}`} article={item.data} />
                ) : (
                  <QuestionCard key={`question-${item.data.id}`} question={item.data} />
                ),
              )}
            </div>
          )}
        </div>

        <div className="lg:col-span-4 bg-surface-container-low border border-outline-variant rounded-xl p-4 space-y-4">
          <h2 className="font-headline-md text-headline-md text-on-surface">{t("activityTitle")}</h2>

          {activity === null ? (
            <p className="font-body-md text-body-md text-on-surface-variant">{t("activityLoading")}</p>
          ) : activity.length === 0 ? (
            <p className="font-body-md text-body-md text-on-surface-variant">{t("activityEmptyState")}</p>
          ) : (
            <ul className="space-y-4">
              {activity.map((entry) => {
                const actionKey = ACTIVITY_ACTION_KEYS[entry.action];
                const actionLabel = actionKey ? t(`activityActions.${actionKey}`) : entry.action;
                return (
                  <li key={entry.id} className="flex gap-2.5">
                    <span className="mt-1.5 size-1.5 rounded-full bg-primary shrink-0" />
                    <div className="min-w-0">
                      <p className="font-body-md text-body-md text-on-surface">
                        <span className="font-medium">{entry.actor_email ?? t("systemActor")}</span>{" "}
                        {actionLabel} {entry.target_repr}
                      </p>
                      <p className="font-mono-sm text-mono-sm text-on-surface-variant mt-0.5">
                        {formatRelativeTime(entry.created_at)}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
