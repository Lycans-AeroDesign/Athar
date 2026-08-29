"use client";

import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";

import { ArticleCard } from "@/components/knowledge/ArticleCard";
import { CategoryPanel } from "@/components/knowledge/CategoryPanel";
import { NewQuestionModal } from "@/components/knowledge/NewQuestionModal";
import { QuestionCard } from "@/components/knowledge/QuestionCard";
import { TagPanel } from "@/components/knowledge/TagPanel";
import { Can } from "@/components/auth/Can";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Link } from "@/i18n/navigation";
import { getArticles, getCategories, getQuestions, getTags } from "@/lib/api/knowledge";
import type { ArticleSummary, Category, QuestionSummary, Tag } from "@/lib/api/types";

export default function KnowledgePage() {
  const t = useTranslations("knowledge.landing");
  const [articles, setArticles] = useState<ArticleSummary[] | null>(null);
  const [questions, setQuestions] = useState<QuestionSummary[] | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [selectedTagId, setSelectedTagId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [askQuestionOpen, setAskQuestionOpen] = useState(false);

  useEffect(() => {
    getArticles().then(setArticles);
    getQuestions().then(setQuestions);
    getCategories().then(setCategories);
    getTags().then(setTags);
  }, []);

  const selectedTagName = tags.find((tag) => tag.id === selectedTagId)?.name ?? null;

  const filteredArticles = useMemo(() => {
    if (!articles) return [];
    return articles.filter((article) => {
      if (selectedCategoryId && article.category?.id !== selectedCategoryId) return false;
      if (selectedTagName && !article.tags.some((tag) => tag.name === selectedTagName)) return false;
      if (search && !article.title.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [articles, selectedCategoryId, selectedTagName, search]);

  const filteredQuestions = useMemo(() => {
    if (!questions) return [];
    return questions.filter((question) => {
      if (selectedCategoryId) return false; // Questions have no category - a category filter excludes them.
      if (selectedTagName && !question.tags.some((tag) => tag.name === selectedTagName)) return false;
      if (search && !question.title.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [questions, selectedCategoryId, selectedTagName, search]);

  const featuredArticle = articles?.find((article) => article.status === "PUBLISHED") ?? null;
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
      <div className="text-center border-b border-outline-variant pb-8 space-y-4">
        <h1 className="font-display text-display text-on-surface">{t("heroTitle")}</h1>
        <div className="relative max-w-xl mx-auto">
          <Icon name="search" className="absolute start-4 top-1/2 -translate-y-1/2 text-outline" />
          <input
            className="w-full bg-surface-container-low border border-outline-variant rounded-full py-2.5 ps-12 pe-4 font-body-md text-body-md text-on-surface placeholder:text-outline focus:outline-none focus:ring-2 focus:ring-primary transition-all"
            placeholder={t("heroSearchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex items-center justify-center gap-3">
          <Can permission="question.create">
            <Button variant="secondary" onClick={() => setAskQuestionOpen(true)}>
              <Icon name="forum" size={18} />
              {t("askQuestionButton")}
            </Button>
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

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-4 space-y-6">
          <CategoryPanel categories={categories} selectedCategoryId={selectedCategoryId} onSelect={setSelectedCategoryId} />
          <TagPanel tags={tags} selectedTagId={selectedTagId} onSelect={setSelectedTagId} />
        </div>

        <div className="lg:col-span-8 space-y-6">
          {featuredArticle && !selectedCategoryId && !selectedTagId && !search && (
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

          <div className="flex items-center justify-between">
            <h2 className="font-headline-md text-headline-md text-on-surface">{t("recentlyUpdatedTitle")}</h2>
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

      <NewQuestionModal open={askQuestionOpen} onOpenChange={setAskQuestionOpen} />
    </div>
  );
}
