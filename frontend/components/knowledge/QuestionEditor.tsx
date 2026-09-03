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
import { createQuestion, updateQuestion } from "@/lib/api/knowledge";
import type { QuestionDetail, Visibility } from "@/lib/api/types";

interface QuestionEditorProps {
  /** Omit to ask a new question; pass an existing one to edit it in place. */
  question?: QuestionDetail;
  /** Reports whether the draft differs from `question` (or, for a new question, from empty) - lets the parent page's "Back" link confirm before discarding. */
  onDirtyChange?: (dirty: boolean) => void;
}

// Structured like ArticleEditor.tsx, simpler since asking/editing a question
// has no draft/publish workflow - one Save action either way.
export function QuestionEditor({ question, onDirtyChange }: QuestionEditorProps) {
  const t = useTranslations("knowledge.question");
  const router = useRouter();

  const [title, setTitle] = useState(question?.title ?? "");
  const [body, setBody] = useState(question?.body ?? "");
  const [tags, setTags] = useState<string[]>(question?.tags.map((tag) => tag.name) ?? []);
  const [visibility, setVisibility] = useState<Visibility>(question?.visibility ?? "PUBLIC");
  const [restrictedAccessDraft, setRestrictedAccessDraft] = useState<RestrictedAccessDraft>(
    EMPTY_RESTRICTED_ACCESS_DRAFT,
  );
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isDirty =
    (question
      ? title !== question.title ||
        body !== question.body ||
        tags.join(",") !== question.tags.map((tag) => tag.name).join(",") ||
        visibility !== question.visibility
      : title.length > 0 || body.length > 0 || tags.length > 0 || visibility !== "PUBLIC") ||
    restrictedAccessDraft.pendingAdd.length > 0 ||
    restrictedAccessDraft.pendingRemoveGrantIds.length > 0;

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  async function syncRestrictedAccess(questionId: string) {
    for (const grantId of restrictedAccessDraft.pendingRemoveGrantIds) {
      await removeAccessGrant(grantId);
    }
    for (const user of restrictedAccessDraft.pendingAdd) {
      await addAccessGrant("question", questionId, user.id);
    }
  }

  async function handleSave() {
    setIsSaving(true);
    setError(null);
    try {
      const saved = question
        ? await updateQuestion(question.id, { title, body, tag_names: tags, visibility })
        : await createQuestion({ title, body, tag_names: tags, visibility });
      await syncRestrictedAccess(saved.id);
      router.push(`/knowledge/questions/${saved.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setIsSaving(false);
    }
  }

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
        {visibility === "RESTRICTED" && (
          <RestrictedAccessPicker
            initialGrants={question?.restricted_to ?? []}
            value={restrictedAccessDraft}
            onChange={setRestrictedAccessDraft}
          />
        )}
      </div>

      <MarkdownEditor
        value={body}
        onChange={setBody}
        placeholder={t("bodyPlaceholder")}
        relateFrom={question ? { type: "question", id: question.id } : undefined}
      />

      {error && (
        <p className="font-body-md text-body-md text-error" role="alert">
          {error}
        </p>
      )}

      <div className="flex items-center gap-3">
        <Button onClick={handleSave} disabled={isSaving || !title.trim()}>
          {question ? (isSaving ? t("saving") : t("save")) : isSaving ? t("asking") : t("askButton")}
        </Button>
      </div>
    </div>
  );
}
