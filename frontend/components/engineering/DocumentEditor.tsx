"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";
import { ChangedIndicator } from "@/components/ui/ChangedIndicator";
import { Combobox } from "@/components/ui/Combobox";
import { FileDropzone } from "@/components/ui/FileDropzone";
import { MarkdownEditor } from "@/components/ui/MarkdownEditor";
import { TagInput } from "@/components/ui/TagInput";
import {
  EMPTY_RESTRICTED_ACCESS_DRAFT,
  RestrictedAccessPicker,
  type RestrictedAccessDraft,
} from "@/components/knowledge/RestrictedAccessPicker";
import { addAccessGrant, removeAccessGrant } from "@/lib/api/accessGrants";
import { createDocument, updateDocument, type DocumentWritePayload } from "@/lib/api/documents";
import { uploadFile } from "@/lib/api/files";
import { getCategories } from "@/lib/api/knowledge";
import type { Category, DocType, DocumentDetail, DocumentSource, Visibility } from "@/lib/api/types";
import { useRouter } from "@/i18n/navigation";

const DOC_TYPE_VALUES: DocType[] = [
  "COMPETITION_REPORT",
  "TECHNICAL_REPORT",
  "RESEARCH_PAPER",
  "DATASHEET",
  "MANUAL",
  "REGULATION",
  "PRESENTATION",
  "TRAINING_MATERIAL",
  "REFERENCE",
  "OTHER",
];
const SOURCE_VALUES: DocumentSource[] = ["INTERNAL", "EXTERNAL"];
const VISIBILITY_VALUES: Visibility[] = ["PUBLIC", "RESTRICTED"];

interface DocumentEditorProps {
  document?: DocumentDetail;
  onDirtyChange?: (dirty: boolean) => void;
}

// Structured like ComponentEditor.tsx (closest existing analog - Category
// FK + a file-like primary asset) but with `visibility`, like Article/
// Question - see backend/knowledge/models.py's Document docstring. The file
// itself is a single primary attachment (not a list like Attachments.tsx),
// uploaded standalone first via uploadFile then referenced by id on save -
// same two-phase pattern as every other file relationship in this app.
export function DocumentEditor({ document, onDirtyChange }: DocumentEditorProps) {
  const t = useTranslations("engineering.document");
  const commonT = useTranslations("common");
  const docTypeT = useTranslations("engineering.documentType");
  const sourceT = useTranslations("engineering.documentSource");
  const router = useRouter();

  const [categories, setCategories] = useState<Category[]>([]);
  const [title, setTitle] = useState(document?.title ?? "");
  const [docType, setDocType] = useState<DocType>(document?.doc_type ?? "OTHER");
  const [source, setSource] = useState<DocumentSource>(document?.source ?? "INTERNAL");
  const [author, setAuthor] = useState(document?.author ?? "");
  const [organization, setOrganization] = useState(document?.organization ?? "");
  const [publicationDate, setPublicationDate] = useState<string | null>(document?.publication_date ?? null);
  const [url, setUrl] = useState(document?.url ?? "");
  const [categoryId, setCategoryId] = useState<string | null>(document?.category?.id ?? null);
  const [tags, setTags] = useState<string[]>(document?.tags.map((tag) => tag.name) ?? []);
  const [visibility, setVisibility] = useState<Visibility>(document?.visibility ?? "PUBLIC");
  const [restrictedAccessDraft, setRestrictedAccessDraft] = useState<RestrictedAccessDraft>(
    EMPTY_RESTRICTED_ACCESS_DRAFT,
  );
  const [description, setDescription] = useState(document?.description ?? "");
  const [fileId, setFileId] = useState<string | null>(document?.file?.id ?? null);
  const [fileName, setFileName] = useState(document?.file?.original_filename ?? "");
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getCategories().then(setCategories);
  }, []);

  const fieldChanged = {
    title: title !== (document?.title ?? ""),
    docType: docType !== (document?.doc_type ?? "OTHER"),
    source: source !== (document?.source ?? "INTERNAL"),
    author: author !== (document?.author ?? ""),
    organization: organization !== (document?.organization ?? ""),
    publicationDate: publicationDate !== (document?.publication_date ?? null),
    url: url !== (document?.url ?? ""),
    category: categoryId !== (document?.category?.id ?? null),
    tags: tags.join(",") !== (document?.tags.map((tag) => tag.name).join(",") ?? ""),
    visibility: visibility !== (document?.visibility ?? "PUBLIC"),
    description: description !== (document?.description ?? ""),
    file: fileId !== (document?.file?.id ?? null),
    restrictedAccess:
      restrictedAccessDraft.pendingAdd.length > 0 || restrictedAccessDraft.pendingRemoveGrantIds.length > 0,
  };

  const isDirty = Object.values(fieldChanged).some(Boolean);

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  async function handleFileSelected(file: File) {
    setError(null);
    setUploadProgress(0);
    try {
      const uploaded = await uploadFile(file, { onProgress: setUploadProgress });
      setFileId(uploaded.id);
      setFileName(uploaded.original_filename);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploadProgress(null);
    }
  }

  function buildPayload(): DocumentWritePayload {
    return {
      title,
      description,
      doc_type: docType,
      source,
      author,
      organization,
      publication_date: publicationDate,
      url,
      file_id: fileId,
      category_id: categoryId,
      tag_names: tags,
      visibility,
    };
  }

  async function syncRestrictedAccess(documentId: string) {
    for (const grantId of restrictedAccessDraft.pendingRemoveGrantIds) {
      await removeAccessGrant(grantId);
    }
    for (const user of restrictedAccessDraft.pendingAdd) {
      await addAccessGrant("document", documentId, user.id);
    }
  }

  async function handleSave() {
    setIsSaving(true);
    setError(null);
    try {
      const saved = document
        ? await updateDocument(document.id, buildPayload())
        : await createDocument(buildPayload());
      await syncRestrictedAccess(saved.id);
      router.push(`/documents/${saved.id}`);
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
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <ChangedIndicator changed={fieldChanged.docType}>
            <Combobox
              label={t("docTypeLabel")}
              options={DOC_TYPE_VALUES.map((value) => ({ value, label: docTypeT(value) }))}
              value={docType}
              onChange={(value) => setDocType(value as DocType)}
            />
          </ChangedIndicator>
          <ChangedIndicator changed={fieldChanged.source}>
            <Combobox
              label={t("sourceLabel")}
              options={SOURCE_VALUES.map((value) => ({ value, label: sourceT(value) }))}
              value={source}
              onChange={(value) => setSource(value as DocumentSource)}
            />
          </ChangedIndicator>
          <ChangedIndicator changed={fieldChanged.category}>
            <Combobox
              label={t("categoryPlaceholder")}
              options={categories.map((category) => ({ value: category.id, label: category.name }))}
              value={categoryId}
              onChange={setCategoryId}
            />
          </ChangedIndicator>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <ChangedIndicator changed={fieldChanged.author}>
            <input
              className="block w-full px-4 py-2 font-body-md text-body-md text-on-surface bg-surface-container border border-outline-variant rounded-lg focus:ring-1 focus:ring-primary focus:border-primary outline-none transition-colors"
              placeholder={t("authorPlaceholder")}
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
            />
          </ChangedIndicator>
          <ChangedIndicator changed={fieldChanged.organization}>
            <input
              className="block w-full px-4 py-2 font-body-md text-body-md text-on-surface bg-surface-container border border-outline-variant rounded-lg focus:ring-1 focus:ring-primary focus:border-primary outline-none transition-colors"
              placeholder={t("organizationPlaceholder")}
              value={organization}
              onChange={(e) => setOrganization(e.target.value)}
            />
          </ChangedIndicator>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* Native date input, not DatePicker - publication_date is a plain
              "YYYY-MM-DD" calendar date (Django DateField), same as
              Failure.date/Test.date. */}
          <ChangedIndicator changed={fieldChanged.publicationDate} className="space-y-2">
            <label className="block font-label-caps text-label-caps text-on-surface-variant uppercase">
              {t("publicationDateLabel")}
            </label>
            <input
              type="date"
              className="block w-full px-4 py-2 font-body-md text-body-md text-on-surface bg-surface-container border border-outline-variant rounded-lg focus:ring-1 focus:ring-primary focus:border-primary outline-none transition-colors"
              value={publicationDate ?? ""}
              onChange={(e) => setPublicationDate(e.target.value || null)}
            />
          </ChangedIndicator>
          <ChangedIndicator changed={fieldChanged.url}>
            <input
              className="block w-full px-4 py-2 font-body-md text-body-md text-on-surface bg-surface-container border border-outline-variant rounded-lg focus:ring-1 focus:ring-primary focus:border-primary outline-none transition-colors"
              placeholder={t("urlPlaceholder")}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </ChangedIndicator>
        </div>
        <div className="flex flex-wrap gap-3 items-center">
          <ChangedIndicator changed={fieldChanged.tags} className="flex-1 min-w-[200px]">
            <TagInput value={tags} onChange={setTags} placeholder={t("tagsPlaceholder")} className="w-full" />
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
        <ChangedIndicator changed={fieldChanged.file} className="inline-block" dotPosition="bottom-end">
          <FileDropzone
            onFileSelected={handleFileSelected}
            onRemove={
              fileId
                ? () => {
                    setFileId(null);
                    setFileName("");
                  }
                : undefined
            }
            progress={uploadProgress}
            fileName={fileName || null}
            label={t("uploadFileButton")}
            className="max-w-sm"
          />
        </ChangedIndicator>
        {visibility === "RESTRICTED" && (
          <ChangedIndicator changed={fieldChanged.restrictedAccess}>
            <RestrictedAccessPicker
              initialGrants={document?.restricted_to ?? []}
              value={restrictedAccessDraft}
              onChange={setRestrictedAccessDraft}
            />
          </ChangedIndicator>
        )}
      </div>

      <div className="space-y-2">
        <h3 className="font-label-caps text-label-caps text-on-surface-variant uppercase">{t("descriptionLabel")}</h3>
        <ChangedIndicator changed={fieldChanged.description}>
          <MarkdownEditor
            value={description}
            onChange={setDescription}
            placeholder={t("descriptionPlaceholder")}
            relateFrom={document ? { type: "document", id: document.id } : undefined}
          />
        </ChangedIndicator>
      </div>

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
