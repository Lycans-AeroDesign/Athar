"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { MarkdownEditor } from "@/components/ui/MarkdownEditor";
import { Modal } from "@/components/ui/Modal";
import { useRouter } from "@/i18n/navigation";
import { createQuestion } from "@/lib/api/knowledge";

interface NewQuestionModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function NewQuestionModal({ open, onOpenChange }: NewQuestionModalProps) {
  const t = useTranslations("knowledge.question");
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [tagNames, setTagNames] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAsk() {
    setIsSaving(true);
    setError(null);
    try {
      const question = await createQuestion({
        title,
        body,
        tag_names: tagNames
          .split(",")
          .map((name) => name.trim())
          .filter(Boolean),
      });
      onOpenChange(false);
      router.push(`/knowledge/questions/${question.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={t("askButton")}
      isDirty={title.length > 0 || body.length > 0}
      footer={
        <Button onClick={handleAsk} disabled={isSaving || !title.trim()}>
          {isSaving ? t("asking") : t("askButton")}
        </Button>
      }
    >
      <div className="space-y-4">
        <input
          className="block w-full px-4 py-2 font-body-md text-body-md text-on-surface bg-surface-container border border-outline-variant rounded-lg focus:ring-1 focus:ring-primary focus:border-primary outline-none transition-colors"
          placeholder={t("titlePlaceholder")}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <MarkdownEditor value={body} onChange={setBody} placeholder={t("bodyPlaceholder")} />
        <input
          className="block w-full px-4 py-2 font-body-md text-body-md text-on-surface bg-surface-container border border-outline-variant rounded-lg focus:ring-1 focus:ring-primary focus:border-primary outline-none transition-colors"
          placeholder={t("tagsPlaceholder")}
          value={tagNames}
          onChange={(e) => setTagNames(e.target.value)}
        />
        {error && (
          <p className="font-body-md text-body-md text-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
