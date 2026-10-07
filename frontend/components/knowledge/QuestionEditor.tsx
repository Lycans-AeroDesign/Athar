"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";
import { ChangedIndicator } from "@/components/ui/ChangedIndicator";
import { MarkdownEditor } from "@/components/ui/MarkdownEditor";
import { TagInput } from "@/components/ui/TagInput";
import { CoAuthorPicker } from "@/components/knowledge/CoAuthorPicker";
import { PendingRelations, toRelationInputs, type PendingRelation } from "@/components/knowledge/PendingRelations";
import { ProjectSelect } from "@/components/knowledge/ProjectSelect";
import {
  EMPTY_RESTRICTED_ACCESS_DRAFT,
  RestrictedAccessPicker,
  type RestrictedAccessDraft,
} from "@/components/knowledge/RestrictedAccessPicker";
import { effectiveVisibility, VisibilitySelect } from "@/components/knowledge/VisibilitySelect";
import { useRouter } from "@/i18n/navigation";
import { addAccessGrant, removeAccessGrant } from "@/lib/api/accessGrants";
import { createQuestion, updateQuestion, type QuestionWritePayload } from "@/lib/api/knowledge";
import type { KnowledgeAuthor, QuestionDetail, Visibility } from "@/lib/api/types";
import { useAuth } from "@/lib/auth/AuthProvider";
import { useHasPermission } from "@/lib/auth/permissions";

interface QuestionEditorProps {
  /** Omit to ask a new question; pass an existing one to edit it in place. */
  question?: QuestionDetail;
  /** Reports whether the draft differs from `question` (or, for a new question, from empty) - lets the parent page's "Back" link confirm before discarding. */
  onDirtyChange?: (dirty: boolean) => void;
  /** Preselects the project on a new question (e.g. from a ?project= link). */
  initialProjectId?: string | null;
}

// Structured like ArticleEditor.tsx, simpler since asking/editing a question
// has no draft/publish workflow - one Save action either way.
export function QuestionEditor({ question, onDirtyChange, initialProjectId = null }: QuestionEditorProps) {
  const t = useTranslations("knowledge.question");
  const router = useRouter();
  const { user } = useAuth();
  const canModerate = useHasPermission("question.moderate");

  const [title, setTitle] = useState(question?.title ?? "");
  const [body, setBody] = useState(question?.body ?? "");
  const [tags, setTags] = useState<string[]>(question?.tags.map((tag) => tag.name) ?? []);
  // null = not explicitly chosen (new question only): inherits the project's visibility if one is picked.
  const [visibility, setVisibility] = useState<Visibility | null>(question?.visibility ?? null);
  const [projectId, setProjectId] = useState<string | null>(initialProjectId);
  const [projectVisibility, setProjectVisibility] = useState<Visibility | null>(null);
  const [pendingRelations, setPendingRelations] = useState<PendingRelation[]>([]);
  const [coAuthors, setCoAuthors] = useState<KnowledgeAuthor[]>(question?.co_authors ?? []);
  const [restrictedAccessDraft, setRestrictedAccessDraft] = useState<RestrictedAccessDraft>(
    EMPTY_RESTRICTED_ACCESS_DRAFT,
  );
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resolvedVisibility = effectiveVisibility(visibility, question ? null : projectVisibility);
  const canEditCoAuthors = !question || question.author?.id === user?.id || canModerate;

  const fieldChanged = {
    title: title !== (question?.title ?? ""),
    body: body !== (question?.body ?? ""),
    tags: tags.join(",") !== (question?.tags.map((tag) => tag.name).join(",") ?? ""),
    visibility: visibility !== (question?.visibility ?? null),
    coAuthors: coAuthors.map((u) => u.id).join(",") !== (question?.co_authors ?? []).map((u) => u.id).join(","),
    project: !question && projectId !== initialProjectId,
    relations: pendingRelations.length > 0,
    restrictedAccess:
      restrictedAccessDraft.pendingAdd.length > 0 || restrictedAccessDraft.pendingRemoveGrantIds.length > 0,
  };

  const isDirty = Object.values(fieldChanged).some(Boolean);

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  function buildPayload(isCreate: boolean): QuestionWritePayload {
    return {
      title,
      body,
      tag_names: tags,
      ...(visibility ? { visibility } : {}),
      ...(fieldChanged.coAuthors ? { co_author_ids: coAuthors.map((u) => u.id) } : {}),
      ...(isCreate ? { project_id: projectId, relations: toRelationInputs(pendingRelations) } : {}),
    };
  }

  async function syncRestrictedAccess(questionId: string) {
    for (const grantId of restrictedAccessDraft.pendingRemoveGrantIds) {
      await removeAccessGrant(grantId);
    }
    for (const grantee of restrictedAccessDraft.pendingAdd) {
      await addAccessGrant("question", questionId, grantee.id);
    }
  }

  async function handleSave() {
    setIsSaving(true);
    setError(null);
    try {
      const saved = question
        ? await updateQuestion(question.id, buildPayload(false))
        : await createQuestion({ ...buildPayload(true), title });
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
        <ChangedIndicator changed={fieldChanged.title}>
          <input
            className="w-full font-headline-lg text-headline-lg font-bold border-none bg-transparent placeholder:text-on-surface-variant/50 focus:ring-0 p-0 text-on-surface outline-none"
            placeholder={t("titlePlaceholder")}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </ChangedIndicator>
        <div className="flex flex-wrap gap-3 items-center">
          <ChangedIndicator changed={fieldChanged.tags} className="flex-1 min-w-[200px]">
            <TagInput value={tags} onChange={setTags} placeholder={t("tagsPlaceholder")} className="w-full" />
          </ChangedIndicator>
          <ChangedIndicator changed={fieldChanged.visibility} className="w-56">
            <VisibilitySelect
              placeholder={t("visibilityLabel")}
              value={visibility}
              onChange={setVisibility}
              inheritFrom={question ? null : projectVisibility}
            />
          </ChangedIndicator>
        </div>
        {!question && (
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
        <ChangedIndicator changed={fieldChanged.coAuthors}>
          <CoAuthorPicker
            value={coAuthors}
            onChange={setCoAuthors}
            authorId={question ? question.author?.id : user?.id}
            canEdit={canEditCoAuthors}
          />
        </ChangedIndicator>
        {resolvedVisibility === "RESTRICTED" && (
          <ChangedIndicator changed={fieldChanged.restrictedAccess}>
            <RestrictedAccessPicker
              initialGrants={question?.restricted_to ?? []}
              value={restrictedAccessDraft}
              onChange={setRestrictedAccessDraft}
            />
          </ChangedIndicator>
        )}
      </div>

      <ChangedIndicator changed={fieldChanged.body}>
        <MarkdownEditor
          value={body}
          onChange={setBody}
          placeholder={t("bodyPlaceholder")}
          relateFrom={question ? { type: "question", id: question.id } : undefined}
        />
      </ChangedIndicator>

      {!question && (
        <ChangedIndicator changed={fieldChanged.relations}>
          <PendingRelations sourceType="question" value={pendingRelations} onChange={setPendingRelations} />
        </ChangedIndicator>
      )}

      {error && (
        <p className="font-body-md text-body-md text-error" role="alert">
          {error}
        </p>
      )}

      <div className="flex items-center gap-3">
        <Button onClick={handleSave} disabled={isSaving || !title.trim() || (!!question && !isDirty)}>
          {question ? (isSaving ? t("saving") : t("save")) : isSaving ? t("asking") : t("askButton")}
        </Button>
      </div>
    </div>
  );
}
