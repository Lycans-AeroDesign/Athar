"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { FileDropzone } from "@/components/ui/FileDropzone";
import { FilePreviewModal } from "@/components/ui/FilePreviewModal";
import { Icon } from "@/components/ui/Icon";
import {
  addComponentAttachment,
  addFailureAttachment,
  addProjectAttachment,
  addSopAttachment,
  addTestAttachment,
  getComponentAttachments,
  getFailureAttachments,
  getProjectAttachments,
  getSopAttachments,
  getTestAttachments,
  removeComponentAttachment,
  removeFailureAttachment,
  removeProjectAttachment,
  removeSopAttachment,
  removeTestAttachment,
} from "@/lib/api/engineering";
import { downloadFile, uploadFile } from "@/lib/api/files";
import {
  addArticleAttachment,
  addQuestionAttachment,
  getArticleAttachments,
  getQuestionAttachments,
  removeArticleAttachment,
  removeQuestionAttachment,
} from "@/lib/api/knowledge";
import type { KnowledgeAttachment, RelatableType } from "@/lib/api/types";

// Document is deliberately excluded - it has a single primary `file`/`url`
// field, not a list of attachments (see backend/knowledge/models.py's
// Document docstring: "not generic file storage"). Its detail page renders
// that file directly instead of mounting this component.
type AttachableType = Exclude<RelatableType, "document">;

interface AttachmentsProps {
  type: AttachableType;
  id: string;
  /** Same edit rights as the owning item itself - see attachment.add/remove's
   * permission check in backend/knowledge/services.py. */
  canEdit: boolean;
}

// One {get, add, remove} triple per relatable type - a lookup table scales
// better than an ever-growing if/else chain now that this covers six types,
// not just article/question.
const ATTACHMENT_API: Record<
  AttachableType,
  {
    get: (id: string) => Promise<KnowledgeAttachment[]>;
    add: (id: string, fileId: string) => Promise<KnowledgeAttachment>;
    remove: (id: string, attachmentId: string) => Promise<void>;
  }
> = {
  article: { get: getArticleAttachments, add: addArticleAttachment, remove: removeArticleAttachment },
  question: { get: getQuestionAttachments, add: addQuestionAttachment, remove: removeQuestionAttachment },
  project: { get: getProjectAttachments, add: addProjectAttachment, remove: removeProjectAttachment },
  component: { get: getComponentAttachments, add: addComponentAttachment, remove: removeComponentAttachment },
  failure: { get: getFailureAttachments, add: addFailureAttachment, remove: removeFailureAttachment },
  sop: { get: getSopAttachments, add: addSopAttachment, remove: removeSopAttachment },
  test: { get: getTestAttachments, add: addTestAttachment, remove: removeTestAttachment },
};

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// The file itself is uploaded standalone first (uploadFile), then associated
// via its own endpoint (ATTACHMENT_API[type].add) - same two-phase pattern
// as BrandingSettingsForm.tsx's logo/favicon upload.
export function Attachments({ type, id, canEdit }: AttachmentsProps) {
  const t = useTranslations("knowledge.attachments");
  const [attachments, setAttachments] = useState<KnowledgeAttachment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [previewAttachment, setPreviewAttachment] = useState<KnowledgeAttachment | null>(null);

  useEffect(() => {
    ATTACHMENT_API[type]
      .get(id)
      .then(setAttachments)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [type, id]);

  async function handleFileSelected(file: File) {
    setError(null);
    setUploadProgress(0);
    try {
      const uploaded = await uploadFile(file, { onProgress: setUploadProgress });
      const attachment = await ATTACHMENT_API[type].add(id, uploaded.id);
      setAttachments((prev) => [...(prev ?? []), attachment]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploadProgress(null);
    }
  }

  async function handleRemove(attachmentId: string) {
    setError(null);
    try {
      await ATTACHMENT_API[type].remove(id, attachmentId);
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
      <h3 className="font-headline-md text-headline-md text-on-surface">{t("title")}</h3>
      {canEdit && (
        <FileDropzone
          onFileSelected={handleFileSelected}
          progress={uploadProgress}
          label={t("addButton")}
          className="max-w-sm"
        />
      )}

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
                onClick={() => setPreviewAttachment(attachment)}
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

      {previewAttachment && (
        <FilePreviewModal
          open
          onOpenChange={(open) => !open && setPreviewAttachment(null)}
          file={previewAttachment.file}
        />
      )}
    </div>
  );
}
