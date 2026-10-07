"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";
import { ChangedIndicator } from "@/components/ui/ChangedIndicator";
import { Combobox } from "@/components/ui/Combobox";
import { MarkdownEditor } from "@/components/ui/MarkdownEditor";
import { TagInput } from "@/components/ui/TagInput";
import { PendingRelations, toRelationInputs, type PendingRelation } from "@/components/knowledge/PendingRelations";
import { ProjectSelect } from "@/components/knowledge/ProjectSelect";
import { effectiveVisibility, VisibilitySelect } from "@/components/knowledge/VisibilitySelect";
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
  /** Preselects the project on a new article (e.g. from a project page's ?project= link). */
  initialProjectId?: string | null;
}

// Structured like BrandingSettingsForm.tsx - local-state draft seeded from
// the article prop, submitted via the API modules in lib/api/knowledge.ts.
// Unlike that form, there's no single "Save"/"Discard" pair: which action
// buttons show depends on the article's current status and whether the
// viewer holds article.publish (see buildActions below).
export function ArticleEditor({ article, onDirtyChange, initialProjectId = null }: ArticleEditorProps) {
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
  // null = not explicitly chosen (new article only): inherits the project's visibility if one is picked.
  const [visibility, setVisibility] = useState<Visibility | null>(article?.visibility ?? null);
  const [projectId, setProjectId] = useState<string | null>(initialProjectId);
  const [projectVisibility, setProjectVisibility] = useState<Visibility | null>(null);
  const [pendingRelations, setPendingRelations] = useState<PendingRelation[]>([]);
  const [restrictedAccessDraft, setRestrictedAccessDraft] = useState<RestrictedAccessDraft>(
    EMPTY_RESTRICTED_ACCESS_DRAFT,
  );
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resolvedVisibility = effectiveVisibility(visibility, article ? null : projectVisibility);

  useEffect(() => {
    getCategories().then(setCategories);
  }, []);

  const fieldChanged = {
    title: title !== (article?.title ?? ""),
    excerpt: excerpt !== (article?.excerpt ?? ""),
    content: content !== (article?.content ?? ""),
    category: categoryId !== (article?.category?.id ?? null),
    tags: tags.join(",") !== (article?.tags.map((tag) => tag.name).join(",") ?? ""),
    visibility: visibility !== (article?.visibility ?? null),
    project: !article && projectId !== initialProjectId,
    relations: pendingRelations.length > 0,
    restrictedAccess:
      restrictedAccessDraft.pendingAdd.length > 0 || restrictedAccessDraft.pendingRemoveGrantIds.length > 0,
  };

  const isDirty = Object.values(fieldChanged).some(Boolean);

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  function buildPayload(isCreate: boolean): ArticleWritePayload {
    return {
      title,
      excerpt,
      content,
      category_id: categoryId,
      tag_names: tags,
      ...(visibility ? { visibility } : {}),
      ...(isCreate ? { project_id: projectId, relations: toRelationInputs(pendingRelations) } : {}),
    };
  }

  function handleDiscard() {
    setTitle(article?.title ?? "");
    setExcerpt(article?.excerpt ?? "");
    setContent(article?.content ?? "");
    setCategoryId(article?.category?.id ?? null);
    setTags(article?.tags.map((tag) => tag.name) ?? []);
    setVisibility(article?.visibility ?? null);
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
      const saved = article
        ? await updateArticle(article.id, buildPayload(false))
        : await createArticle(buildPayload(true));
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
        <ChangedIndicator changed={fieldChanged.title}>
          <input
            className="w-full font-headline-lg text-headline-lg font-bold border-none bg-transparent placeholder:text-on-surface-variant/50 focus:ring-0 p-0 text-on-surface outline-none"
            placeholder={t("titlePlaceholder")}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </ChangedIndicator>
        <div className="flex flex-wrap gap-3 items-center">
          <ChangedIndicator changed={fieldChanged.category} className="w-56">
            <Combobox
              placeholder={t("categoryPlaceholder")}
              options={categories.map((category) => ({ value: category.id, label: category.name }))}
              value={categoryId}
              onChange={setCategoryId}
            />
          </ChangedIndicator>
          <ChangedIndicator changed={fieldChanged.tags} className="flex-1 min-w-[200px]">
            <TagInput value={tags} onChange={setTags} placeholder={t("tagsPlaceholder")} className="w-full" />
          </ChangedIndicator>
          <ChangedIndicator changed={fieldChanged.visibility} className="w-56">
            <VisibilitySelect
              placeholder={t("visibilityLabel")}
              value={visibility}
              onChange={setVisibility}
              inheritFrom={article ? null : projectVisibility}
            />
          </ChangedIndicator>
        </div>
        <ChangedIndicator changed={fieldChanged.excerpt}>
          <input
            className="w-full bg-transparent border-none font-body-md text-body-md text-on-surface-variant placeholder:text-on-surface-variant/50 focus:ring-0 p-0 outline-none"
            placeholder={t("excerptPlaceholder")}
            value={excerpt}
            onChange={(e) => setExcerpt(e.target.value)}
          />
        </ChangedIndicator>
        {!article && (
          <ChangedIndicator changed={fieldChanged.project}>
            <ProjectSelect
              value={projectId}
              onChange={(id, project) => {
                setProjectId(id);
                setProjectVisibility(project?.visibility ?? null);
              }}
            />
          </ChangedIndicator>
        )}
        {resolvedVisibility === "RESTRICTED" && (
          <ChangedIndicator changed={fieldChanged.restrictedAccess}>
            <RestrictedAccessPicker
              initialGrants={article?.restricted_to ?? []}
              value={restrictedAccessDraft}
              onChange={setRestrictedAccessDraft}
            />
          </ChangedIndicator>
        )}
      </div>

      <ChangedIndicator changed={fieldChanged.content}>
        <MarkdownEditor
          value={content}
          onChange={setContent}
          placeholder={t("contentPlaceholder")}
          relateFrom={article ? { type: "article", id: article.id } : undefined}
        />
      </ChangedIndicator>

      {!article && (
        <ChangedIndicator changed={fieldChanged.relations}>
          <PendingRelations sourceType="article" value={pendingRelations} onChange={setPendingRelations} />
        </ChangedIndicator>
      )}

      {error && (
        <p className="font-body-md text-body-md text-error" role="alert">
          {error}
        </p>
      )}

      {/* Stacked full-width below sm - up to three buttons on one row doesn't fit a phone.
          Discard/Save styling and dirty-gating match the settings forms (BrandingSettingsForm.tsx). */}
      <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-3 *:w-full sm:*:w-auto">
        {article && (
          <Button variant="secondary" onClick={handleDiscard} disabled={isSaving || !isDirty}>
            {commonT("discard")}
          </Button>
        )}
        <Button onClick={() => saveAndThen()} disabled={isSaving || !title.trim() || (!!article && !isDirty)}>
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
