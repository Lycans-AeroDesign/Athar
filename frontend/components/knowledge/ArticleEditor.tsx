"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Combobox } from "@/components/ui/Combobox";
import { MarkdownEditor } from "@/components/ui/MarkdownEditor";
import { useRouter } from "@/i18n/navigation";
import {
  type ArticleWritePayload,
  createArticle,
  getCategories,
  publishArticle,
  submitArticle,
  updateArticle,
} from "@/lib/api/knowledge";
import type { ArticleDetail, Category } from "@/lib/api/types";
import { useHasPermission } from "@/lib/auth/permissions";

interface ArticleEditorProps {
  /** Omit to create a new article; pass an existing one to edit it in place. */
  article?: ArticleDetail;
}

// Structured like BrandingSettingsForm.tsx - local-state draft seeded from
// the article prop, submitted via the API modules in lib/api/knowledge.ts.
// Unlike that form, there's no single "Save"/"Discard" pair: which action
// buttons show depends on the article's current status and whether the
// viewer holds article.publish (see buildActions below).
export function ArticleEditor({ article }: ArticleEditorProps) {
  const t = useTranslations("knowledge.article");
  const router = useRouter();
  const canPublish = useHasPermission("article.publish");

  const [categories, setCategories] = useState<Category[]>([]);
  const [title, setTitle] = useState(article?.title ?? "");
  const [excerpt, setExcerpt] = useState(article?.excerpt ?? "");
  const [content, setContent] = useState(article?.content ?? "");
  const [categoryId, setCategoryId] = useState<string | null>(article?.category?.id ?? null);
  const [tagNames, setTagNames] = useState(article?.tags.map((tag) => tag.name).join(", ") ?? "");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getCategories().then(setCategories);
  }, []);

  function buildPayload(): ArticleWritePayload {
    return {
      title,
      excerpt,
      content,
      category_id: categoryId,
      tag_names: tagNames
        .split(",")
        .map((name) => name.trim())
        .filter(Boolean),
    };
  }

  async function saveAndThen(after?: (id: string) => Promise<unknown>) {
    setIsSaving(true);
    setError(null);
    try {
      const saved = article ? await updateArticle(article.id, buildPayload()) : await createArticle(buildPayload());
      if (after) await after(saved.id);
      router.push(`/knowledge/articles/${saved.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setIsSaving(false);
    }
  }

  const status = article?.status ?? "DRAFT";
  const canSubmitForReview = !canPublish && (status === "DRAFT" || !article);
  const canPublishNow = canPublish && (status === "DRAFT" || status === "IN_REVIEW" || !article);
  const saveLabel = !article || status === "DRAFT" ? t("saveDraft") : t("save");

  return (
    <div className="space-y-4 max-w-[800px] mx-auto">
      <div className="space-y-4 border-b border-outline-variant pb-4">
        <input
          className="w-full font-headline-lg text-headline-lg font-bold border-none bg-transparent placeholder:text-on-surface-variant/50 focus:ring-0 p-0 text-on-surface outline-none"
          placeholder={t("titlePlaceholder")}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <div className="flex flex-wrap gap-3 items-center">
          <div className="w-56">
            <Combobox
              placeholder={t("categoryPlaceholder")}
              options={categories.map((category) => ({ value: category.id, label: category.name }))}
              value={categoryId}
              onChange={setCategoryId}
            />
          </div>
          <input
            className="flex-1 min-w-[200px] bg-surface-container-low px-4 py-2 rounded-xl border border-outline-variant font-body-md text-body-md text-on-surface placeholder:text-on-surface-variant/50 outline-none"
            placeholder={t("tagsPlaceholder")}
            value={tagNames}
            onChange={(e) => setTagNames(e.target.value)}
          />
        </div>
        <input
          className="w-full bg-transparent border-none font-body-md text-body-md text-on-surface-variant placeholder:text-on-surface-variant/50 focus:ring-0 p-0 outline-none"
          placeholder={t("excerptPlaceholder")}
          value={excerpt}
          onChange={(e) => setExcerpt(e.target.value)}
        />
      </div>

      <MarkdownEditor value={content} onChange={setContent} placeholder={t("contentPlaceholder")} />

      {error && (
        <p className="font-body-md text-body-md text-error" role="alert">
          {error}
        </p>
      )}

      <div className="flex items-center gap-3">
        <Button variant="secondary" onClick={() => saveAndThen()} disabled={isSaving || !title.trim()}>
          {saveLabel}
        </Button>
        {canSubmitForReview && (
          <Button onClick={() => saveAndThen(submitArticle)} disabled={isSaving || !title.trim()}>
            {t("submitForReview")}
          </Button>
        )}
        {canPublishNow && (
          <Button onClick={() => saveAndThen(publishArticle)} disabled={isSaving || !title.trim()}>
            {t("publish")}
          </Button>
        )}
      </div>
    </div>
  );
}
