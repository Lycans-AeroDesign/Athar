"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { downloadFile, uploadFile } from "@/lib/api/files";
import {
  addArticleAttachment,
  addQuestionAttachment,
  getArticleAttachments,
  getQuestionAttachments,
  removeArticleAttachment,
  removeQuestionAttachment,
} from "@/lib/api/knowledge";
import type { KnowledgeAttachment } from "@/lib/api/types";

interface AttachmentsProps {
  type: "article" | "question";
  id: string;
  /** Same edit rights as the article/question itself - see attachment.add/remove's
   * permission check in backend/knowledge/services.py. */
  canEdit: boolean;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// The file itself is uploaded standalone first (uploadFile), then associated
// via its own endpoint (addArticleAttachment/addQuestionAttachment) - same
// two-phase pattern as BrandingSettingsForm.tsx's logo/favicon upload.
export function Attachments({ type, id, canEdit }: AttachmentsProps) {
  const t = useTranslations("knowledge.attachments");
  const [attachments, setAttachments] = useState<KnowledgeAttachment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const request = type === "article" ? getArticleAttachments(id) : getQuestionAttachments(id);
    request.then(setAttachments).catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [type, id]);

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    setIsUploading(true);
    try {
      const uploaded = await uploadFile(file);
      const attachment =
        type === "article"
          ? await addArticleAttachment(id, uploaded.id)
          : await addQuestionAttachment(id, uploaded.id);
      setAttachments((prev) => [...(prev ?? []), attachment]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsUploading(false);
    }
  }

  async function handleRemove(attachmentId: string) {
    setError(null);
    try {
      if (type === "article") await removeArticleAttachment(id, attachmentId);
      else await removeQuestionAttachment(id, attachmentId);
      setAttachments((prev) => (prev ?? []).filter((attachment) => attachment.id !== attachmentId));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleDownload(attachment: KnowledgeAttachment) {
    setError(null);
    try {
      await downloadFile(attachment.file.id, attachment.file.original_filename);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  if (!attachments) return null;
  if (attachments.length === 0 && !canEdit) return null;

  return (
    <div className="pt-6 border-t border-outline-variant space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-headline-md text-headline-md text-on-surface">{t("title")}</h3>
        {canEdit && (
          <>
            <Button variant="ghost" onClick={() => fileInputRef.current?.click()} disabled={isUploading}>
              <Icon name="upload" size={16} />
              {isUploading ? t("uploading") : t("addButton")}
            </Button>
            <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileSelected} />
          </>
        )}
      </div>

      {attachments.length === 0 ? (
        <p className="font-body-md text-body-md text-on-surface-variant">{t("emptyState")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {attachments.map((attachment) => (
            <li
              key={attachment.id}
              className="flex items-center gap-3 bg-surface-container-low border border-outline-variant rounded-lg px-3 py-2"
            >
              <Icon name="description" size={18} className="text-on-surface-variant shrink-0" />
              <button
                type="button"
                onClick={() => handleDownload(attachment)}
                className="flex-1 min-w-0 text-start font-body-md text-body-md text-on-surface hover:text-primary transition-colors truncate"
              >
                {attachment.file.original_filename}
              </button>
              <span className="font-mono-sm text-mono-sm text-on-surface-variant shrink-0">
                {formatFileSize(attachment.file.size)}
              </span>
              <button
                type="button"
                onClick={() => handleDownload(attachment)}
                aria-label={t("downloadButton")}
                className="text-on-surface-variant hover:text-primary transition-colors shrink-0"
              >
                <Icon name="download" size={16} />
              </button>
              {canEdit && (
                <button
                  type="button"
                  onClick={() => handleRemove(attachment.id)}
                  aria-label={t("removeButton")}
                  className="text-on-surface-variant hover:text-error transition-colors shrink-0"
                >
                  <Icon name="close" size={16} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p className="font-body-md text-body-md text-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
