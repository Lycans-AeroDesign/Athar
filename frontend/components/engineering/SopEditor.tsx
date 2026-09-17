"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";
import { ChangedIndicator } from "@/components/ui/ChangedIndicator";
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
import { createSop, updateSop, type SopWritePayload } from "@/lib/api/engineering";
import { getCategories } from "@/lib/api/knowledge";
import type { Category, SopDetail, Visibility } from "@/lib/api/types";

const VISIBILITY_VALUES: Visibility[] = ["PUBLIC", "RESTRICTED"];

interface SopEditorProps {
  sop?: SopDetail;
  onDirtyChange?: (dirty: boolean) => void;
}

// Structured like ArticleEditor.tsx - no draft/review workflow (see
// backend/knowledge/models.py's Sop docstring), so one Save action.
// `safety_notes` is kept as its own field (rendered as a distinct warning
// callout on the detail page) while everything else - Purpose/Prerequisites/
// Procedure/Verification/etc. from docs/VISION.md #15 - collapses into one
// markdown `content` body, reusing MarkdownEditor exactly as Article does.
export function SopEditor({ sop, onDirtyChange }: SopEditorProps) {
  const t = useTranslations("engineering.sop");
  const commonT = useTranslations("common");
  const router = useRouter();

  const [categories, setCategories] = useState<Category[]>([]);
  const [title, setTitle] = useState(sop?.title ?? "");
  const [categoryId, setCategoryId] = useState<string | null>(sop?.category?.id ?? null);
  const [mandatory, setMandatory] = useState(sop?.mandatory ?? false);
  const [safetyNotes, setSafetyNotes] = useState(sop?.safety_notes ?? "");
  const [content, setContent] = useState(sop?.content ?? "");
  const [tags, setTags] = useState<string[]>(sop?.tags.map((tag) => tag.name) ?? []);
  const [visibility, setVisibility] = useState<Visibility>(sop?.visibility ?? "PUBLIC");
  const [restrictedAccessDraft, setRestrictedAccessDraft] = useState<RestrictedAccessDraft>(
    EMPTY_RESTRICTED_ACCESS_DRAFT,
  );
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getCategories().then(setCategories);
  }, []);

  const fieldChanged = {
    title: title !== (sop?.title ?? ""),
    category: categoryId !== (sop?.category?.id ?? null),
    mandatory: mandatory !== (sop?.mandatory ?? false),
    safetyNotes: safetyNotes !== (sop?.safety_notes ?? ""),
    content: content !== (sop?.content ?? ""),
    tags: tags.join(",") !== (sop?.tags.map((tag) => tag.name).join(",") ?? ""),
    visibility: visibility !== (sop?.visibility ?? "PUBLIC"),
    restrictedAccess:
      restrictedAccessDraft.pendingAdd.length > 0 || restrictedAccessDraft.pendingRemoveGrantIds.length > 0,
  };

  const isDirty = Object.values(fieldChanged).some(Boolean);

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  function buildPayload(): SopWritePayload {
    return {
      title,
      category_id: categoryId,
      mandatory,
      safety_notes: safetyNotes,
      content,
      visibility,
      tag_names: tags,
    };
  }

  async function syncRestrictedAccess(sopId: string) {
    for (const grantId of restrictedAccessDraft.pendingRemoveGrantIds) {
      await removeAccessGrant(grantId);
    }
    for (const user of restrictedAccessDraft.pendingAdd) {
      await addAccessGrant("sop", sopId, user.id);
    }
  }

  async function handleSave() {
    setIsSaving(true);
    setError(null);
    try {
      const saved = sop ? await updateSop(sop.id, buildPayload()) : await createSop(buildPayload());
      await syncRestrictedAccess(saved.id);
      router.push(`/sops/${saved.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setIsSaving(false);
    }
  }

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
          <ChangedIndicator changed={fieldChanged.mandatory} className="inline-block">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={mandatory}
                onChange={(e) => setMandatory(e.target.checked)}
                className="rounded border-outline-variant text-primary focus:ring-primary w-4 h-4"
              />
              <span className="font-body-md text-body-md text-on-surface">{t("mandatoryLabel")}</span>
            </label>
          </ChangedIndicator>
          <ChangedIndicator changed={fieldChanged.visibility} className="w-48">
            <Combobox
              placeholder={t("visibilityLabel")}
              options={VISIBILITY_VALUES.map((value) => ({ value, label: t(`visibility${value}`) }))}
              value={visibility}
              onChange={(value) => setVisibility(value as Visibility)}
            />
          </ChangedIndicator>
        </div>
        {visibility === "RESTRICTED" && (
          <ChangedIndicator changed={fieldChanged.restrictedAccess}>
            <RestrictedAccessPicker
              initialGrants={sop?.restricted_to ?? []}
              value={restrictedAccessDraft}
              onChange={setRestrictedAccessDraft}
            />
          </ChangedIndicator>
        )}
      </div>

      <div className="space-y-2">
        <label className="block font-label-caps text-label-caps text-on-surface-variant uppercase">
          {t("safetyNotesLabel")}
        </label>
        <ChangedIndicator changed={fieldChanged.safetyNotes}>
          <textarea
            className="block w-full min-h-[80px] px-4 py-2 font-body-md text-body-md text-on-surface bg-surface-container border border-outline-variant rounded-lg focus:ring-1 focus:ring-primary focus:border-primary outline-none transition-colors"
            placeholder={t("safetyNotesPlaceholder")}
            value={safetyNotes}
            onChange={(e) => setSafetyNotes(e.target.value)}
          />
        </ChangedIndicator>
      </div>

      <ChangedIndicator changed={fieldChanged.content}>
        <MarkdownEditor
          value={content}
          onChange={setContent}
          placeholder={t("contentPlaceholder")}
          relateFrom={sop ? { type: "sop", id: sop.id } : undefined}
        />
      </ChangedIndicator>

      {error && (
        <p className="font-body-md text-body-md text-error" role="alert">
          {error}
        </p>
      )}

      <div className="flex items-center gap-3">
        <Button onClick={handleSave} disabled={isSaving || !title.trim()}>
          {isSaving ? commonT("saving") : commonT("save")}
        </Button>
      </div>
    </div>
  );
}
