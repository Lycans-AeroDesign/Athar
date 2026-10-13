"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { ArticleCard } from "@/components/knowledge/ArticleCard";
import { QuestionCard } from "@/components/knowledge/QuestionCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { Icon } from "@/components/ui/Icon";
import { Pagination } from "@/components/ui/Pagination";
import { Link } from "@/i18n/navigation";
import { getUserActivity } from "@/lib/api/audit";
import { getUserContributions } from "@/lib/api/knowledge";
import type {
  Answer,
  ActivityEntry,
  ArticleSummary,
  ComponentSummary,
  ContributionPeriod,
  ContributionType,
  DocumentSummary,
  FailureSummary,
  ProjectSummary,
  QuestionSummary,
  RelatableType,
  SopSummary,
  TestSummary,
  UserProfile,
} from "@/lib/api/types";
import { formatRelativeTime } from "@/lib/datetime";
import { RELATABLE_ICON, RELATABLE_ROUTE_PREFIX } from "@/lib/knowledgeTypes";

// Same audit action -> translation-key remap as the Dashboard's own "Recent
// Team Activity" widget (see app/[locale]/(protected)/page.tsx) - kept as
// its own copy rather than a shared import since it's a small fixed lookup,
// not logic, and the two widgets' translation namespaces differ ("dashboard"
// vs "userProfile").
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

function RecentActivity({ userId }: { userId: string }) {
  const t = useTranslations("userProfile");
  // Keyed by userId, same "avoid a plain setState(null) reset in the effect
  // body" pattern the parent component uses for its own tab/page results -
  // switching between profiles never shows a stale list.
  const [result, setResult] = useState<{ userId: string; entries: ActivityEntry[] } | null>(null);
  const activity = result?.userId === userId ? result.entries : null;

  useEffect(() => {
    getUserActivity(userId).then((data) => setResult({ userId, entries: data.results }));
  }, [userId]);

  return (
    <div className="bg-surface-container-low border border-outline-variant rounded-xl p-4 space-y-3">
      <h3 className="flex items-center gap-2 font-label-caps text-label-caps font-bold text-on-surface uppercase">
        <Icon name="schedule" size={16} className="text-primary" />
        {t("recentActivityTitle")}
      </h3>
      {activity === null ? (
        <p className="font-body-md text-body-md text-on-surface-variant">{t("loadingTab")}</p>
      ) : activity.length === 0 ? (
        <p className="font-body-md text-body-md text-on-surface-variant">{t("recentActivityEmptyState")}</p>
      ) : (
        <ul className="space-y-3">
          {activity.map((entry) => {
            const actionKey = ACTIVITY_ACTION_KEYS[entry.action];
            const actionLabel = actionKey ? t(`activityActions.${actionKey}`) : entry.action;
            return (
              <li key={entry.id} className="flex gap-2.5">
                <span className="mt-1.5 size-1.5 rounded-full bg-primary shrink-0" />
                <div className="min-w-0">
                  <p className="font-body-md text-body-md text-on-surface">
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
  );
}

// Shared by /users/[id] (someone else's public profile) and /account (your
// own contributions tab) - factored out once the same score + type tiles +
// paginated list needed to appear in both places, rather than the account
// page re-fetching/re-rendering a second copy of this logic.

// Tile order - Knowledge (Article/Question/Answer), then Engineering
// (Project/Component/Failure/Sop/Test), then Resources (Document).
const TYPES: ContributionType[] = [
  "article",
  "question",
  "answer",
  "project",
  "component",
  "failure",
  "sop",
  "test",
  "document",
];

const TYPE_LABEL_KEYS: Record<ContributionType, string> = {
  article: "statArticles",
  question: "statQuestions",
  answer: "statAnswers",
  project: "statProjects",
  component: "statComponents",
  failure: "statFailures",
  sop: "statSops",
  test: "statTests",
  document: "statDocuments",
};

// Order matches the score card's tab row - most-recent window first, same
// convention as the leaderboard widget on the Dashboard (page.tsx).
const PERIODS: ContributionPeriod[] = ["month", "year", "all"];

const PERIOD_LABEL_KEYS: Record<ContributionPeriod, string> = {
  month: "periodMonth",
  year: "periodYear",
  all: "periodAll",
};

const TAB_ICONS: Record<ContributionType, string> = {
  article: "menu_book",
  question: "forum",
  answer: "send",
  project: "architecture",
  component: "settings_input_component",
  failure: "report_problem",
  sop: "description",
  test: "science",
  document: "folder",
};

function AnswerRow({ answer }: { answer: Answer }) {
  const t = useTranslations("userProfile");
  return (
    <Link
      href={`/knowledge/questions/${answer.question_id}`}
      className="block bg-surface-container-low border border-outline-variant rounded-xl p-4 hover:shadow-[0_1px_3px_0_rgba(0,0,0,0.08)] transition-shadow"
    >
      <div className="flex items-center justify-between mb-2">
        {answer.is_accepted && (
          <span className="flex items-center gap-1 text-primary font-label-caps text-label-caps uppercase">
            <Icon name="check_circle" size={14} />
            {t("acceptedBadge")}
          </span>
        )}
        <span className="font-mono-sm text-mono-sm text-on-surface-variant ms-auto">
          {formatRelativeTime(answer.created_at)}
        </span>
      </div>
      <p className="font-body-md text-body-md text-on-surface-variant line-clamp-2">{answer.body}</p>
    </Link>
  );
}

// Project/Component/Failure/Sop share one generic row - each is a
// RelatableType, so its icon/route come straight from the shared lookup
// tables the rest of the app already uses (RelatedContent.tsx, search, ...).
function EngineeringRow({ type, item }: { type: RelatableType; item: { id: string; name?: string; title?: string } }) {
  return (
    <Link
      href={`${RELATABLE_ROUTE_PREFIX[type]}/${item.id}`}
      className="flex items-center gap-3 bg-surface-container-low border border-outline-variant rounded-xl p-4 hover:shadow-[0_1px_3px_0_rgba(0,0,0,0.08)] transition-shadow"
    >
      <Icon name={RELATABLE_ICON[type]} size={20} className="text-on-surface-variant shrink-0" />
      <span className="font-body-md text-body-md text-on-surface truncate">{item.name ?? item.title}</span>
    </Link>
  );
}

interface ContributionsPanelProps {
  profile: UserProfile;
}

export function ContributionsPanel({ profile }: ContributionsPanelProps) {
  const t = useTranslations("userProfile");
  // Opens on whichever type this person has contributed the most of, rather
  // than always on Articles - a member whose work is all Components would
  // otherwise land on an empty list.
  const [tab, setTab] = useState<ContributionType>(() =>
    TYPES.reduce((best, type) => (profile.stats[type] > profile.stats[best] ? type : best), TYPES[0]),
  );
  const [page, setPage] = useState(1);
  const [scorePeriod, setScorePeriod] = useState<ContributionPeriod>("all");
  const periodStat = profile.periods[scorePeriod];
  const hasContributions = TYPES.some((type) => profile.stats[type] > 0);

  // Keyed by profile+tab+page - same "avoid a plain setResult(null) reset in
  // the effect body" pattern used throughout this app's list pages. Keying
  // on profile.id too means switching between someone else's profile and
  // your own (both render this same component) never shows a stale list.
  const [result, setResult] = useState<{ key: string; items: unknown[]; hasNext: boolean; count: number } | null>(null);
  const resultKey = `${profile.id}:${tab}:${page}`;
  const items = result?.key === resultKey ? result.items : null;

  useEffect(() => {
    if (!hasContributions) return;
    getUserContributions(profile.id, tab, page).then((data) =>
      setResult({ key: resultKey, items: data.results, hasNext: data.next !== null, count: data.count }),
    );
  }, [profile.id, tab, page, resultKey, hasContributions]);

  function selectTab(next: ContributionType) {
    setTab(next);
    setPage(1);
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_18rem] gap-6 items-start">
      <div className="space-y-6 min-w-0">
        {!hasContributions ? (
          <EmptyState icon="trophy" message={t("noContributions")} />
        ) : (
          <>
            {/* One tile per contribution type - doubles as the type picker
                for the list below, so each count is shown once instead of in
                both a stat grid and a tab row. Zero-count types stay visible
                (so the grid doesn't reshuffle between profiles) but dimmed
                and not clickable. */}
            <div className="grid grid-cols-3 sm:grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-2">
              {TYPES.map((type) => {
                const count = profile.stats[type];
                const isActive = tab === type;
                return (
                  <button
                    key={type}
                    type="button"
                    onClick={() => selectTab(type)}
                    disabled={count === 0}
                    aria-pressed={isActive}
                    className={`flex flex-col items-center gap-0.5 rounded-xl border px-2 py-3 text-center transition-colors disabled:cursor-default disabled:opacity-45 ${
                      isActive
                        ? "border-primary bg-primary-container text-on-primary-container"
                        : "border-outline-variant bg-surface-container-low text-on-surface enabled:hover:border-primary"
                    }`}
                  >
                    <Icon name={TAB_ICONS[type]} size={18} className={isActive ? "" : "text-on-surface-variant"} />
                    <span className="font-headline-md text-headline-md">{count}</span>
                    <span className="font-body-md text-body-md leading-tight truncate max-w-full">
                      {t(TYPE_LABEL_KEYS[type])}
                    </span>
                    {type === "answer" && profile.stats.accepted_answers > 0 && (
                      <span className="flex items-center gap-0.5 font-mono-sm text-mono-sm text-primary">
                        <Icon name="check_circle" size={12} />
                        {t("acceptedCount", { count: profile.stats.accepted_answers })}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="space-y-4">
              <h3 className="flex items-center gap-2 font-headline-md text-headline-md text-on-surface">
                <Icon name={TAB_ICONS[tab]} size={20} className="text-primary" />
                {t(TYPE_LABEL_KEYS[tab])}
                <span className="font-mono-sm text-mono-sm text-on-surface-variant">{profile.stats[tab]}</span>
              </h3>

              {items === null ? (
                <p className="font-body-md text-body-md text-on-surface-variant">{t("loadingTab")}</p>
              ) : items.length === 0 ? (
                <p className="font-body-md text-body-md text-on-surface-variant">{t("emptyState")}</p>
              ) : (
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                  {tab === "article" &&
                    (items as ArticleSummary[]).map((item) => <ArticleCard key={item.id} article={item} />)}
                  {tab === "question" &&
                    (items as QuestionSummary[]).map((item) => <QuestionCard key={item.id} question={item} />)}
                  {tab === "answer" && (items as Answer[]).map((item) => <AnswerRow key={item.id} answer={item} />)}
                  {tab === "project" &&
                    (items as ProjectSummary[]).map((item) => (
                      <EngineeringRow key={item.id} type="project" item={item} />
                    ))}
                  {tab === "component" &&
                    (items as ComponentSummary[]).map((item) => (
                      <EngineeringRow key={item.id} type="component" item={item} />
                    ))}
                  {tab === "failure" &&
                    (items as FailureSummary[]).map((item) => (
                      <EngineeringRow key={item.id} type="failure" item={item} />
                    ))}
                  {tab === "sop" &&
                    (items as SopSummary[]).map((item) => <EngineeringRow key={item.id} type="sop" item={item} />)}
                  {tab === "test" &&
                    (items as TestSummary[]).map((item) => <EngineeringRow key={item.id} type="test" item={item} />)}
                  {tab === "document" &&
                    (items as DocumentSummary[]).map((item) => (
                      <EngineeringRow key={item.id} type="document" item={item} />
                    ))}
                </div>
              )}

              {items && items.length > 0 && (
                <Pagination
                  page={page}
                  hasNext={result?.hasNext ?? false}
                  hasPrevious={page > 1}
                  onPageChange={setPage}
                  totalCount={result?.count}
                />
              )}
            </div>
          </>
        )}
      </div>

      <aside className="space-y-4 lg:sticky lg:top-0">
        <div className="bg-primary-container rounded-xl border border-outline-variant p-4 space-y-3">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="font-label-caps text-label-caps text-on-primary-container uppercase">{t("scoreLabel")}</p>
              <p className="font-display text-display text-on-primary-container">{periodStat.score}</p>
              <p className="font-body-md text-body-md text-on-primary-container/80">
                {periodStat.rank !== null
                  ? t("standingLabel", { rank: periodStat.rank, total: profile.total_members })
                  : t("standingNone")}
              </p>
            </div>
            <Icon name="trophy" size={36} className="text-on-primary-container opacity-70 shrink-0" />
          </div>
          <div className="flex items-center gap-1 rounded-lg bg-on-primary-container/10 p-1">
            {PERIODS.map((period) => (
              <button
                key={period}
                type="button"
                onClick={() => setScorePeriod(period)}
                className={`flex-1 px-2 py-1 rounded-md font-label-caps text-label-caps uppercase transition-colors ${
                  scorePeriod === period
                    ? "bg-surface-container-lowest text-primary"
                    : "text-on-primary-container/70 hover:text-on-primary-container"
                }`}
              >
                {t(PERIOD_LABEL_KEYS[period])}
              </button>
            ))}
          </div>
        </div>

        <RecentActivity userId={profile.id} />
      </aside>
    </div>
  );
}
