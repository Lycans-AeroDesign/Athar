"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";
import { MarkdownEditor } from "@/components/ui/MarkdownEditor";
import { TagInput } from "@/components/ui/TagInput";
import { useRouter } from "@/i18n/navigation";
import { createQuestion } from "@/lib/api/knowledge";

interface QuestionEditorProps {
  /** Reports whether the draft has any content - lets the parent page's "Back" link confirm before discarding. */
  onDirtyChange?: (dirty: boolean) => void;
}

// Create-only (there's no question-editing flow yet, inline or otherwise) -
// structured like ArticleEditor.tsx but simpler, since asking a question has
// no draft/publish workflow: one submit, straight to the new question.
export function QuestionEditor({ onDirtyChange }: QuestionEditorProps) {
  const t = useTranslations("knowledge.question");
  const router = useRouter();

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isDirty = title.length > 0 || body.length > 0 || tags.length > 0;

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  async function handleAsk() {
    setIsSaving(true);
    setError(null);
    try {
      const question = await createQuestion({ title, body, tag_names: tags });
      router.push(`/knowledge/questions/${question.id}`);
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
        <TagInput value={tags} onChange={setTags} placeholder={t("tagsPlaceholder")} />
      </div>

      <MarkdownEditor value={body} onChange={setBody} placeholder={t("bodyPlaceholder")} />

      {error && (
        <p className="font-body-md text-body-md text-error" role="alert">
          {error}
        </p>
      )}

      <div className="flex items-center gap-3">
        <Button onClick={handleAsk} disabled={isSaving || !title.trim()}>
          {isSaving ? t("asking") : t("askButton")}
        </Button>
      </div>
    </div>
  );
}
