"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { ArticleCard } from "@/components/knowledge/ArticleCard";
import { QuestionCard } from "@/components/knowledge/QuestionCard";
import { Icon } from "@/components/ui/Icon";
import { Pagination } from "@/components/ui/Pagination";
import { StatCard } from "@/components/ui/StatCard";
import { Link } from "@/i18n/navigation";
import { getUserActivity } from "@/lib/api/audit";
import { getUserContributions } from "@/lib/api/knowledge";
import type {
  Answer,
  ArticleSummary,
  AuditLogEntry,
  ComponentSummary,
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
  const [result, setResult] = useState<{ userId: string; entries: AuditLogEntry[] } | null>(null);
  const activity = result?.userId === userId ? result.entries : null;

  useEffect(() => {
    getUserActivity(userId).then((data) => setResult({ userId, entries: data.results }));
  }, [userId]);

  return (
    <div className="space-y-3">
      <h3 className="flex items-center gap-2 font-label-caps text-label-caps text-on-surface-variant uppercase">
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
  );
}

// Shared by /users/[id] (someone else's public profile) and /account (your
// own "My Contributions" section) - factored out once the same stats grid +
// tabs + paginated list needed to appear in both places, rather than the
// account page re-fetching/re-rendering a second copy of this logic.

// Same three clusters used for both the stat cards and the tab row below -
// "Knowledge" (Article/Question/Answer, plus the accepted_answers stat which
// has no tab of its own), "Engineering" (Project/Component/Failure/Sop/
// Test), "Resources" (Document) - visually grouping stats/tabs this way
// beats one undifferentiated grid/row now that there are 8 tabs + 2
// standalone stats to make sense of at a glance.
const TAB_GROUPS: ContributionType[][] = [
  ["article", "question", "answer"],
  ["project", "component", "failure", "sop", "test"],
  ["document"],
];

const TAB_LABEL_KEYS: Record<ContributionType, string> = {
  article: "tabArticle",
  question: "tabQuestion",
  answer: "tabAnswer",
  project: "tabProject",
  component: "tabComponent",
  failure: "tabFailure",
  sop: "tabSop",
  test: "tabTest",
  document: "tabDocument",
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
  const [tab, setTab] = useState<ContributionType>("article");
  const [page, setPage] = useState(1);

  // Keyed by profile+tab+page - same "avoid a plain setResult(null) reset in
  // the effect body" pattern used throughout this app's list pages. Keying
  // on profile.id too means switching between someone else's profile and
  // your own (both render this same component) never shows a stale list.
  const [result, setResult] = useState<{ key: string; items: unknown[]; hasNext: boolean; count: number } | null>(
    null,
  );
  const resultKey = `${profile.id}:${tab}:${page}`;
  const items = result?.key === resultKey ? result.items : null;

  useEffect(() => {
    getUserContributions(profile.id, tab, page).then((data) =>
      setResult({ key: resultKey, items: data.results, hasNext: data.next !== null, count: data.count }),
    );
  }, [profile.id, tab, page, resultKey]);

  function selectTab(next: ContributionType) {
    setTab(next);
    setPage(1);
  }

  return (
    <div className="space-y-6">
      <div className="bg-primary-container rounded-xl border border-outline-variant p-6 flex items-center justify-between gap-4">
        <div>
          <p className="font-label-caps text-label-caps text-on-primary-container uppercase">{t("scoreLabel")}</p>
          <p className="font-display text-display text-on-primary-container mt-1">{profile.score}</p>
        </div>
        <Icon name="trophy" size={40} className="text-on-primary-container opacity-70 shrink-0" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <h3 className="flex items-center gap-2 font-label-caps text-label-caps text-on-surface-variant uppercase mb-3">
            <Icon name="menu_book" size={16} className="text-primary" />
            {t("groupKnowledgeTitle")}
          </h3>
          <div className="grid grid-cols-2 gap-3">
            <StatCard layout="stacked" label={t("statArticles")} value={profile.stats.article} icon="menu_book" />
            <StatCard layout="stacked" label={t("statQuestions")} value={profile.stats.question} icon="forum" />
            <StatCard layout="stacked" label={t("statAnswers")} value={profile.stats.answer} icon="send" />
            <StatCard
              layout="stacked"
              label={t("statAcceptedAnswers")}
              value={profile.stats.accepted_answers}
              icon="check_circle"
            />
          </div>
        </div>
        <div>
          <h3 className="flex items-center gap-2 font-label-caps text-label-caps text-on-surface-variant uppercase mb-3">
            <Icon name="architecture" size={16} className="text-primary" />
            {t("groupEngineeringTitle")}
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <StatCard layout="stacked" label={t("statProjects")} value={profile.stats.project} icon="architecture" />
            <StatCard
              layout="stacked"
              label={t("statComponents")}
              value={profile.stats.component}
              icon="settings_input_component"
            />
            <StatCard layout="stacked" label={t("statFailures")} value={profile.stats.failure} icon="report_problem" />
            <StatCard layout="stacked" label={t("statSops")} value={profile.stats.sop} icon="description" />
            <StatCard layout="stacked" label={t("statTests")} value={profile.stats.test} icon="science" />
          </div>
        </div>
        <div>
          <h3 className="flex items-center gap-2 font-label-caps text-label-caps text-on-surface-variant uppercase mb-3">
            <Icon name="folder" size={16} className="text-primary" />
            {t("groupResourcesTitle")}
          </h3>
          <div className="grid grid-cols-1 gap-3">
            <StatCard layout="stacked" label={t("statDocuments")} value={profile.stats.document} icon="folder" />
          </div>
        </div>
      </div>

      <RecentActivity userId={profile.id} />

      <div className="border-b border-outline-variant">
        <div className="flex flex-wrap items-center gap-2">
          {TAB_GROUPS.map((group, groupIndex) => (
            <div key={groupIndex} className="flex flex-wrap items-center gap-2">
              {groupIndex > 0 && <span className="w-px h-5 bg-outline-variant mx-1" aria-hidden="true" />}
              {group.map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => selectTab(value)}
                  className={`flex items-center gap-1.5 px-4 py-2 font-label-caps text-label-caps uppercase border-b-2 transition-colors -mb-px ${
                    tab === value
                      ? "text-primary border-primary"
                      : "text-on-surface-variant border-transparent hover:text-on-surface"
                  }`}
                >
                  <Icon name={TAB_ICONS[value]} size={16} />
                  {t(TAB_LABEL_KEYS[value])}
                  <span className="font-mono-sm text-mono-sm">({profile.stats[value]})</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>

      {items === null ? (
        <p className="font-body-md text-body-md text-on-surface-variant">{t("loadingTab")}</p>
      ) : items.length === 0 ? (
        <p className="font-body-md text-body-md text-on-surface-variant">{t("emptyState")}</p>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {tab === "article" &&
            (items as ArticleSummary[]).map((item) => <ArticleCard key={item.id} article={item} />)}
          {tab === "question" &&
            (items as QuestionSummary[]).map((item) => <QuestionCard key={item.id} question={item} />)}
          {tab === "answer" && (items as Answer[]).map((item) => <AnswerRow key={item.id} answer={item} />)}
          {tab === "project" &&
            (items as ProjectSummary[]).map((item) => <EngineeringRow key={item.id} type="project" item={item} />)}
          {tab === "component" &&
            (items as ComponentSummary[]).map((item) => <EngineeringRow key={item.id} type="component" item={item} />)}
          {tab === "failure" &&
            (items as FailureSummary[]).map((item) => <EngineeringRow key={item.id} type="failure" item={item} />)}
          {tab === "sop" && (items as SopSummary[]).map((item) => <EngineeringRow key={item.id} type="sop" item={item} />)}
          {tab === "test" && (items as TestSummary[]).map((item) => <EngineeringRow key={item.id} type="test" item={item} />)}
          {tab === "document" &&
            (items as DocumentSummary[]).map((item) => <EngineeringRow key={item.id} type="document" item={item} />)}
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
  );
}
