"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Combobox } from "@/components/ui/Combobox";
import { MarkdownEditor } from "@/components/ui/MarkdownEditor";
import { TagInput } from "@/components/ui/TagInput";
import {
  EMPTY_RESTRICTED_ACCESS_DRAFT,
  RestrictedAccessPicker,
  type RestrictedAccessDraft,
} from "@/components/knowledge/RestrictedAccessPicker";
import { useRouter } from "@/i18n/navigation";
import { addAccessGrant, removeAccessGrant } from "@/lib/api/accessGrants";
import {
  type ArticleWritePayload,
  createArticle,
  getCategories,
  publishArticle,
  submitArticle,
  updateArticle,
} from "@/lib/api/knowledge";
import type { ArticleDetail, Category, Visibility } from "@/lib/api/types";
import { useHasPermission } from "@/lib/auth/permissions";

interface ArticleEditorProps {
  /** Omit to create a new article; pass an existing one to edit it in place. */
  article?: ArticleDetail;
  /** Reports whether the draft differs from `article` (or, for a new article, from empty) - lets a parent page's own "Back" link confirm before discarding. */
  onDirtyChange?: (dirty: boolean) => void;
}

// Structured like BrandingSettingsForm.tsx - local-state draft seeded from
// the article prop, submitted via the API modules in lib/api/knowledge.ts.
// Unlike that form, there's no single "Save"/"Discard" pair: which action
// buttons show depends on the article's current status and whether the
// viewer holds article.publish (see buildActions below).
export function ArticleEditor({ article, onDirtyChange }: ArticleEditorProps) {
  const t = useTranslations("knowledge.article");
  const commonT = useTranslations("common");
  const router = useRouter();
  const canPublish = useHasPermission("article.publish");

  const [categories, setCategories] = useState<Category[]>([]);
  const [title, setTitle] = useState(article?.title ?? "");
  const [excerpt, setExcerpt] = useState(article?.excerpt ?? "");
  const [content, setContent] = useState(article?.content ?? "");
  const [categoryId, setCategoryId] = useState<string | null>(article?.category?.id ?? null);
  const [tags, setTags] = useState<string[]>(article?.tags.map((tag) => tag.name) ?? []);
  const [visibility, setVisibility] = useState<Visibility>(article?.visibility ?? "PUBLIC");
  const [restrictedAccessDraft, setRestrictedAccessDraft] = useState<RestrictedAccessDraft>(
    EMPTY_RESTRICTED_ACCESS_DRAFT,
  );
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getCategories().then(setCategories);
  }, []);

  const isDirty =
    title !== (article?.title ?? "") ||
    excerpt !== (article?.excerpt ?? "") ||
    content !== (article?.content ?? "") ||
    categoryId !== (article?.category?.id ?? null) ||
    tags.join(",") !== (article?.tags.map((tag) => tag.name).join(",") ?? "") ||
    visibility !== (article?.visibility ?? "PUBLIC") ||
    restrictedAccessDraft.pendingAdd.length > 0 ||
    restrictedAccessDraft.pendingRemoveGrantIds.length > 0;

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  function buildPayload(): ArticleWritePayload {
    return {
      title,
      excerpt,
      content,
      category_id: categoryId,
      tag_names: tags,
      visibility,
    };
  }

  function handleDiscard() {
    setTitle(article?.title ?? "");
    setExcerpt(article?.excerpt ?? "");
    setContent(article?.content ?? "");
    setCategoryId(article?.category?.id ?? null);
    setTags(article?.tags.map((tag) => tag.name) ?? []);
    setVisibility(article?.visibility ?? "PUBLIC");
    setRestrictedAccessDraft(EMPTY_RESTRICTED_ACCESS_DRAFT);
    setError(null);
  }

  async function syncRestrictedAccess(articleId: string) {
    for (const grantId of restrictedAccessDraft.pendingRemoveGrantIds) {
      await removeAccessGrant(grantId);
    }
    for (const user of restrictedAccessDraft.pendingAdd) {
      await addAccessGrant("article", articleId, user.id);
    }
  }

  async function saveAndThen(after?: (id: string) => Promise<unknown>) {
    setIsSaving(true);
    setError(null);
    try {
      const saved = article ? await updateArticle(article.id, buildPayload()) : await createArticle(buildPayload());
      await syncRestrictedAccess(saved.id);
      if (after) await after(saved.id);
      router.push(`/knowledge/articles/${saved.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setIsSaving(false);
    }
  }

  const status = article?.status ?? "DRAFT";
  const canSubmitForReview = !canPublish && (status === "DRAFT" || status === "REJECTED" || !article);
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
          <TagInput value={tags} onChange={setTags} placeholder={t("tagsPlaceholder")} className="flex-1 min-w-[200px]" />
          <div className="w-48">
            <Combobox
              placeholder={t("visibilityLabel")}
              options={(["PUBLIC", "RESTRICTED"] as Visibility[]).map((value) => ({
                value,
                label: t(`visibility${value}`),
              }))}
              value={visibility}
              onChange={(value) => setVisibility(value as Visibility)}
            />
          </div>
        </div>
        <input
          className="w-full bg-transparent border-none font-body-md text-body-md text-on-surface-variant placeholder:text-on-surface-variant/50 focus:ring-0 p-0 outline-none"
          placeholder={t("excerptPlaceholder")}
          value={excerpt}
          onChange={(e) => setExcerpt(e.target.value)}
        />
        {visibility === "RESTRICTED" && (
          <RestrictedAccessPicker
            initialGrants={article?.restricted_to ?? []}
            value={restrictedAccessDraft}
            onChange={setRestrictedAccessDraft}
          />
        )}
      </div>

      <MarkdownEditor
        value={content}
        onChange={setContent}
        placeholder={t("contentPlaceholder")}
        relateFrom={article ? { type: "article", id: article.id } : undefined}
      />

      {error && (
        <p className="font-body-md text-body-md text-error" role="alert">
          {error}
        </p>
      )}

      <div className="flex items-center gap-3">
        <Button variant="secondary" onClick={() => saveAndThen()} disabled={isSaving || !title.trim()}>
          {saveLabel}
        </Button>
        {article && (
          <Button variant="ghost" onClick={handleDiscard} disabled={isSaving || !isDirty}>
            {commonT("discard")}
          </Button>
        )}
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
