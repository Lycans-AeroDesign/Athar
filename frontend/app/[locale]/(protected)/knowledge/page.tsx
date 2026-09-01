"use client";

import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";

import { ArticleCard } from "@/components/knowledge/ArticleCard";
import { CategoryPanel } from "@/components/knowledge/CategoryPanel";
import { QuestionCard } from "@/components/knowledge/QuestionCard";
import { ARTICLE_STATUS_LABEL_KEYS } from "@/components/knowledge/StatusPill";
import { TagPanel } from "@/components/knowledge/TagPanel";
import { Can } from "@/components/auth/Can";
import { Button } from "@/components/ui/Button";
import { Combobox } from "@/components/ui/Combobox";
import { Icon } from "@/components/ui/Icon";
import { Link } from "@/i18n/navigation";
import { getArticles, getCategories, getQuestions, getTags } from "@/lib/api/knowledge";
import type { ArticleStatusFilter, ArticleSummary, Category, QuestionSummary, Tag } from "@/lib/api/types";

// "ALL" plus every status Article.Status defines backend-side (see
// backend/knowledge/models.py) - the list endpoint defaults to PUBLISHED
// (see ArticleListCreateView.get), and for anything else (including ALL)
// returns the viewer's own articles unless they hold article.review/
// article.publish, in which case they see everyone's - so this filter is
// also how an author reaches their own drafts/rejected articles, not just
// how an admin/reviewer reaches archived ones.
const ARTICLE_STATUSES: ArticleStatusFilter[] = ["ALL", "PUBLISHED", "DRAFT", "IN_REVIEW", "REJECTED", "ARCHIVED"];

export default function KnowledgePage() {
  const t = useTranslations("knowledge.landing");
  const statusT = useTranslations("knowledge.status");
  const [questions, setQuestions] = useState<QuestionSummary[] | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [selectedTagId, setSelectedTagId] = useState<string | null>(null);
  // Defaults to PUBLISHED (not ALL) - the general Knowledge browsing
  // experience shouldn't change for anyone who never touches this filter.
  const [articleStatus, setArticleStatus] = useState<ArticleStatusFilter>("PUBLISHED");

  // Keyed by the status it was fetched for, rather than reset with a plain
  // setArticles(null) at the top of the effect below - that runs setState
  // synchronously in the effect body, which React's own lint rule flags as
  // a cascading-render footgun. Comparing here at render time instead means
  // the only setState call is the one already inside the fetch's .then().
  const [articlesResult, setArticlesResult] = useState<{
    status: ArticleStatusFilter;
    articles: ArticleSummary[];
  } | null>(null);
  const articles = articlesResult?.status === articleStatus ? articlesResult.articles : null;
  // Shared across all four fetches below - each still resolves independently
  // (a failed tag list shouldn't block the article grid), but previously a
  // rejected promise here just left "Loading..." showing forever.
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getArticles(articleStatus).then(
      (fetched) => setArticlesResult({ status: articleStatus, articles: fetched }),
      (err) => setError(err instanceof Error ? err.message : String(err)),
    );
  }, [articleStatus]);

  useEffect(() => {
    const onError = (err: unknown) => setError(err instanceof Error ? err.message : String(err));
    getQuestions().then(setQuestions, onError);
    getCategories().then(setCategories, onError);
    getTags().then(setTags, onError);
  }, []);

  const selectedTagName = tags.find((tag) => tag.id === selectedTagId)?.name ?? null;

  const filteredArticles = useMemo(() => {
    if (!articles) return [];
    return articles.filter((article) => {
      if (selectedCategoryId && article.category?.id !== selectedCategoryId) return false;
      if (selectedTagName && !article.tags.some((tag) => tag.name === selectedTagName)) return false;
      return true;
    });
  }, [articles, selectedCategoryId, selectedTagName]);

  const filteredQuestions = useMemo(() => {
    // getQuestions() already returns every question regardless of status
    // (see QuestionListCreateView.get - it only filters when ?status= is
    // explicitly passed, which nothing here does), so "ALL" naturally means
    // every question too. A single specific article status (Draft, Archived,
    // ...) stays articles-only, though - questions have no equivalent of
    // those, so mixing them in would just be confusing.
    if (!questions || (articleStatus !== "PUBLISHED" && articleStatus !== "ALL")) return [];
    return questions.filter((question) => {
      if (selectedCategoryId) return false; // Questions have no category - a category filter excludes them.
      if (selectedTagName && !question.tags.some((tag) => tag.name === selectedTagName)) return false;
      return true;
    });
  }, [questions, selectedCategoryId, selectedTagName, articleStatus]);

  // Suppressed outside the default PUBLISHED view for the same reason as
  // filteredQuestions above - a status/audit view shouldn't spotlight one
  // random published article out of a mixed-status list.
  const featuredArticle =
    articleStatus === "PUBLISHED" ? (articles?.find((article) => article.status === "PUBLISHED") ?? null) : null;
  const recentItems = useMemo(() => {
    const items: Array<{ type: "article"; data: ArticleSummary } | { type: "question"; data: QuestionSummary }> = [
      ...filteredArticles
        .filter((article) => article.id !== featuredArticle?.id)
        .map((data) => ({ type: "article" as const, data })),
      ...filteredQuestions.map((data) => ({ type: "question" as const, data })),
    ];
    return items.sort((a, b) => (a.data.updated_at < b.data.updated_at ? 1 : -1));
  }, [filteredArticles, filteredQuestions, featuredArticle]);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-outline-variant pb-8">
        <h1 className="font-display text-display text-on-surface">{t("heroTitle")}</h1>
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

      {error && (
        <p className="font-body-md text-body-md text-error" role="alert">
          {error}
        </p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-4 space-y-6">
          <CategoryPanel categories={categories} selectedCategoryId={selectedCategoryId} onSelect={setSelectedCategoryId} />
          <TagPanel tags={tags} selectedTagId={selectedTagId} onSelect={setSelectedTagId} />
        </div>

        <div className="lg:col-span-8 space-y-6">
          {featuredArticle && !selectedCategoryId && !selectedTagId && (
            <Link
              href={`/knowledge/articles/${featuredArticle.id}`}
              className="block bg-primary text-on-primary rounded-xl p-6 space-y-2"
            >
              <span className="inline-flex items-center font-label-caps text-label-caps uppercase bg-surface-container-lowest/20 rounded-full px-3 py-1">
                {t("featuredArticleLabel")}
              </span>
              <h3 className="font-headline-lg text-headline-lg">{featuredArticle.title}</h3>
              {featuredArticle.excerpt && <p className="opacity-90 line-clamp-2">{featuredArticle.excerpt}</p>}
            </Link>
          )}

          <div className="flex items-center justify-between gap-4">
            <h2 className="font-headline-md text-headline-md text-on-surface">{t("recentlyUpdatedTitle")}</h2>
            <div className="w-48 shrink-0">
              <Combobox
                label={t("statusFilterLabel")}
                options={ARTICLE_STATUSES.map((value) => ({
                  value,
                  label: value === "ALL" ? statusT("all") : statusT(ARTICLE_STATUS_LABEL_KEYS[value]),
                }))}
                value={articleStatus}
                onChange={(value) => setArticleStatus(value as ArticleStatusFilter)}
              />
            </div>
          </div>

          {articles === null || questions === null ? (
            <p className="font-body-md text-body-md text-on-surface-variant">{t("loading")}</p>
          ) : recentItems.length === 0 ? (
            <p className="font-body-md text-body-md text-on-surface-variant">{t("emptyState")}</p>
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
      </div>
    </div>
  );
}
