"use client";

import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";

import { ArticleCard } from "@/components/knowledge/ArticleCard";
import { QuestionCard } from "@/components/knowledge/QuestionCard";
import { Can } from "@/components/auth/Can";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { StatCard } from "@/components/ui/StatCard";
import { Link } from "@/i18n/navigation";
import { getKnowledgeActivity } from "@/lib/api/audit";
import { getArticleCount, getArticles, getLeaderboard, getOpenQuestionCount, getQuestions } from "@/lib/api/knowledge";
import type { ActivityEntry, ArticleSummary, ContributionPeriod, LeaderboardEntry, QuestionSummary } from "@/lib/api/types";
import { formatRelativeTime } from "@/lib/datetime";
import { formatPersonName } from "@/lib/format";
import { RELATABLE_ROUTE_PREFIX } from "@/lib/knowledgeTypes";
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

const LEADERBOARD_PERIODS: ContributionPeriod[] = ["month", "year", "all"];

const LEADERBOARD_PERIOD_LABEL_KEYS: Record<ContributionPeriod, string> = {
  month: "periodMonth",
  year: "periodYear",
  all: "periodAll",
};

export default function DashboardPage() {
  const { user } = useAuth();
  const t = useTranslations("dashboard");

  const [articleCount, setArticleCount] = useState<number | null>(null);
  const [openQuestionCount, setOpenQuestionCount] = useState<number | null>(null);
  const [articles, setArticles] = useState<ArticleSummary[] | null>(null);
  const [questions, setQuestions] = useState<QuestionSummary[] | null>(null);
  const [activity, setActivity] = useState<ActivityEntry[] | null>(null);
  const [leaderboardPeriod, setLeaderboardPeriod] = useState<ContributionPeriod>("all");
  // Keyed by period - same "avoid a plain setState(null) reset in the effect
  // body" pattern ContributionsPanel/RecentActivity use, so switching tabs
  // never shows a stale list from the previous period while the new one loads.
  const [leaderboardResult, setLeaderboardResult] = useState<{
    period: ContributionPeriod;
    entries: LeaderboardEntry[];
  } | null>(null);
  const leaderboard = leaderboardResult?.period === leaderboardPeriod ? leaderboardResult.entries : null;
  // One shared banner for any of the six independent fetches below - each
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

  useEffect(() => {
    const onError = (err: unknown) => setLoadError(err instanceof Error ? err.message : String(err));
    getLeaderboard(leaderboardPeriod).then(
      (entries) => setLeaderboardResult({ period: leaderboardPeriod, entries }),
      onError,
    );
  }, [leaderboardPeriod]);

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
            {user ? t("welcomeWithName", { name: formatPersonName(user) ?? user.email }) : t("welcome")}
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

        <div className="lg:col-span-4 space-y-6">
          <div className="bg-surface-container-low border border-outline-variant rounded-xl p-4 space-y-4">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <h2 className="font-headline-md text-headline-md text-on-surface">{t("leaderboardTitle")}</h2>
              <div className="flex items-center gap-1">
                {LEADERBOARD_PERIODS.map((period) => (
                  <button
                    key={period}
                    type="button"
                    onClick={() => setLeaderboardPeriod(period)}
                    className={`px-2.5 py-1 rounded-lg font-label-caps text-label-caps uppercase transition-colors ${
                      leaderboardPeriod === period
                        ? "bg-primary-container text-on-primary-container"
                        : "text-on-surface-variant hover:bg-surface-variant"
                    }`}
                  >
                    {t(LEADERBOARD_PERIOD_LABEL_KEYS[period])}
                  </button>
                ))}
              </div>
            </div>

            {leaderboard === null ? (
              <p className="font-body-md text-body-md text-on-surface-variant">{t("activityLoading")}</p>
            ) : leaderboard.length === 0 ? (
              <p className="font-body-md text-body-md text-on-surface-variant">{t("leaderboardEmptyState")}</p>
            ) : (
              <ol className="space-y-3">
                {leaderboard.slice(0, 5).map((entry, index) => (
                  <li key={entry.user.id} className="flex items-center gap-3">
                    <span className="w-4 font-mono-sm text-mono-sm text-on-surface-variant shrink-0">{index + 1}</span>
                    <Link href={`/users/${entry.user.id}`} className="shrink-0">
                      <Avatar person={entry.user} size="sm" />
                    </Link>
                    <Link
                      href={`/users/${entry.user.id}`}
                      className="flex-1 min-w-0 font-body-md text-body-md text-on-surface truncate hover:text-primary hover:underline transition-colors"
                    >
                      {formatPersonName(entry.user)}
                    </Link>
                    <span className="font-mono-sm text-mono-sm text-on-surface-variant shrink-0">
                      {t("leaderboardPoints", { count: entry.score })}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      </div>

      <div className="bg-surface-container-low border border-outline-variant rounded-xl p-4 space-y-4">
        <h2 className="font-headline-md text-headline-md text-on-surface">{t("activityTitle")}</h2>

        {activity === null ? (
          <p className="font-body-md text-body-md text-on-surface-variant">{t("activityLoading")}</p>
        ) : activity.length === 0 ? (
          <p className="font-body-md text-body-md text-on-surface-variant">{t("activityEmptyState")}</p>
        ) : (
          <ul className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-x-6 gap-y-4">
            {activity.map((entry) => {
              const actionKey = ACTIVITY_ACTION_KEYS[entry.action];
              const actionLabel = actionKey ? t(`activityActions.${actionKey}`) : entry.action;
              return (
                <li key={entry.id} className="flex gap-2.5">
                  <span className="mt-1.5 size-1.5 rounded-full bg-primary shrink-0" />
                  <div className="min-w-0">
                    <p className="font-body-md text-body-md text-on-surface">
                      {entry.actor ? (
                        <Link href={`/users/${entry.actor.id}`} className="font-medium hover:text-primary hover:underline">
                          {formatPersonName(entry.actor)}
                        </Link>
                      ) : (
                        <span className="font-medium">{t("systemActor")}</span>
                      )}{" "}
                      {actionLabel}{" "}
                      {entry.target && (
                        <Link
                          href={`${RELATABLE_ROUTE_PREFIX[entry.target.type]}/${entry.target.id}`}
                          className="text-primary hover:underline"
                        >
                          {entry.target.title}
                        </Link>
                      )}
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
  );
}
