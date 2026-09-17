"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Combobox } from "@/components/ui/Combobox";
import { ChangedIndicator } from "@/components/ui/ChangedIndicator";
import { Icon } from "@/components/ui/Icon";
import { MarkdownEditor } from "@/components/ui/MarkdownEditor";
import { PhotoDropzone } from "@/components/ui/PhotoDropzone";
import { TagInput } from "@/components/ui/TagInput";
import {
  EMPTY_RESTRICTED_ACCESS_DRAFT,
  RestrictedAccessPicker,
  type RestrictedAccessDraft,
} from "@/components/knowledge/RestrictedAccessPicker";
import { useRouter } from "@/i18n/navigation";
import { addAccessGrant, removeAccessGrant } from "@/lib/api/accessGrants";
import { createComponent, updateComponent, type ComponentWritePayload } from "@/lib/api/engineering";
import { uploadFile } from "@/lib/api/files";
import { getCategories } from "@/lib/api/knowledge";
import type {
  Category,
  ComponentDetail,
  ComponentSpecRow,
  ComponentStatus,
  StoredFileRef,
  Visibility,
} from "@/lib/api/types";

const STATUS_VALUES: ComponentStatus[] = ["CERTIFIED", "TESTING", "DEPRECATED"];
const VISIBILITY_VALUES: Visibility[] = ["PUBLIC", "RESTRICTED"];

interface ComponentEditorProps {
  component?: ComponentDetail;
  onDirtyChange?: (dirty: boolean) => void;
}

// Structured like ArticleEditor.tsx - no draft/review workflow (see
// backend/knowledge/models.py's Component docstring), so one Save action.
// `specifications` is the one thing with no equivalent elsewhere in the
// app: a plain repeatable label/value row list, add/remove like TagInput
// but keeping both sides of each pair instead of collapsing to one string.
export function ComponentEditor({ component, onDirtyChange }: ComponentEditorProps) {
  const t = useTranslations("engineering.component");
  const commonT = useTranslations("common");
  const statusT = useTranslations("engineering.componentStatus");
  const router = useRouter();

  const [categories, setCategories] = useState<Category[]>([]);
  const [name, setName] = useState(component?.name ?? "");
  const [categoryId, setCategoryId] = useState<string | null>(component?.category?.id ?? null);
  const [photo, setPhoto] = useState<StoredFileRef | null>(component?.photo ?? null);
  const [photoUploadProgress, setPhotoUploadProgress] = useState<number | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [manufacturer, setManufacturer] = useState(component?.manufacturer ?? "");
  const [partNumber, setPartNumber] = useState(component?.part_number ?? "");
  const [link, setLink] = useState(component?.link ?? "");
  // Kept as the raw text the user is typing (not a number) so the field can
  // be fully cleared mid-edit instead of snapping back to "0" after every
  // backspace - coerced to a number only at dirty-check/save time below.
  const [quantityAvailable, setQuantityAvailable] = useState(String(component?.quantity_available ?? 0));
  const [status, setStatus] = useState<ComponentStatus>(component?.status ?? "TESTING");
  const [summary, setSummary] = useState(component?.summary ?? "");
  const [specs, setSpecs] = useState<ComponentSpecRow[]>(component?.specifications ?? []);
  const [tags, setTags] = useState<string[]>(component?.tags.map((tag) => tag.name) ?? []);
  const [visibility, setVisibility] = useState<Visibility>(component?.visibility ?? "PUBLIC");
  const [restrictedAccessDraft, setRestrictedAccessDraft] = useState<RestrictedAccessDraft>(
    EMPTY_RESTRICTED_ACCESS_DRAFT,
  );
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getCategories().then(setCategories);
  }, []);

  async function handlePhotoSelected(file: File) {
    setPhotoUploadProgress(0);
    setPhotoError(null);
    try {
      setPhoto(await uploadFile(file, { onProgress: setPhotoUploadProgress }));
    } catch (err) {
      setPhotoError(err instanceof Error ? err.message : String(err));
    } finally {
      setPhotoUploadProgress(null);
    }
  }

  // Named per-field so each one can drive its own ChangedIndicator dot below,
  // not just the combined isDirty banner-vs-navigate-away check.
  const fieldChanged = {
    name: name !== (component?.name ?? ""),
    category: categoryId !== (component?.category?.id ?? null),
    photo: (photo?.id ?? null) !== (component?.photo?.id ?? null),
    manufacturer: manufacturer !== (component?.manufacturer ?? ""),
    partNumber: partNumber !== (component?.part_number ?? ""),
    link: link !== (component?.link ?? ""),
    quantityAvailable: (Number(quantityAvailable) || 0) !== (component?.quantity_available ?? 0),
    status: status !== (component?.status ?? "TESTING"),
    summary: summary !== (component?.summary ?? ""),
    specs: JSON.stringify(specs) !== JSON.stringify(component?.specifications ?? []),
    tags: tags.join(",") !== (component?.tags.map((tag) => tag.name).join(",") ?? ""),
    visibility: visibility !== (component?.visibility ?? "PUBLIC"),
    restrictedAccess:
      restrictedAccessDraft.pendingAdd.length > 0 || restrictedAccessDraft.pendingRemoveGrantIds.length > 0,
  };

  const isDirty = Object.values(fieldChanged).some(Boolean);

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  function updateSpecRow(index: number, field: "label" | "value", value: string) {
    setSpecs((prev) => prev.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
  }

  function removeSpecRow(index: number) {
    setSpecs((prev) => prev.filter((_, i) => i !== index));
  }

  function buildPayload(): ComponentWritePayload {
    return {
      name,
      category_id: categoryId,
      photo_id: photo?.id ?? null,
      manufacturer,
      part_number: partNumber,
      link,
      quantity_available: Math.max(0, Number(quantityAvailable) || 0),
      status,
      summary,
      specifications: specs.filter((row) => row.label.trim() || row.value.trim()),
      visibility,
      tag_names: tags,
    };
  }

  async function syncRestrictedAccess(componentId: string) {
    for (const grantId of restrictedAccessDraft.pendingRemoveGrantIds) {
      await removeAccessGrant(grantId);
    }
    for (const user of restrictedAccessDraft.pendingAdd) {
      await addAccessGrant("component", componentId, user.id);
    }
  }

  async function handleSave() {
    setIsSaving(true);
    setError(null);
    try {
      const saved = component
        ? await updateComponent(component.id, buildPayload())
        : await createComponent(buildPayload());
      await syncRestrictedAccess(saved.id);
      router.push(`/components/${saved.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setIsSaving(false);
    }
  }

  return (
    <div className="space-y-4 max-w-[800px] mx-auto">
      <div className="space-y-4 border-b border-outline-variant pb-4">
        <ChangedIndicator changed={fieldChanged.name}>
          <input
            className="w-full font-headline-lg text-headline-lg font-bold border-none bg-transparent placeholder:text-on-surface-variant/50 focus:ring-0 p-0 text-on-surface outline-none"
            placeholder={t("namePlaceholder")}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </ChangedIndicator>
        <ChangedIndicator changed={fieldChanged.photo} className="inline-block" dotPosition="bottom-end">
          <PhotoDropzone
            value={photo}
            onFileSelected={handlePhotoSelected}
            onUnsupportedFile={() => setPhotoError(commonT("unsupportedImageType"))}
            onRemove={photo ? () => setPhoto(null) : undefined}
            removeLabel={t("removePhotoButton")}
            progress={photoUploadProgress}
            alt={t("photoLabel")}
            className="h-32 w-32"
          />
        </ChangedIndicator>
        {photoError && (
          <p className="font-body-md text-body-md text-error" role="alert">
            {photoError}
          </p>
        )}
        <div className="flex flex-wrap gap-3 items-center">
          <ChangedIndicator changed={fieldChanged.category} className="w-56">
            <Combobox
              placeholder={t("categoryPlaceholder")}
              options={categories.map((category) => ({ value: category.id, label: category.name }))}
              value={categoryId}
              onChange={setCategoryId}
            />
          </ChangedIndicator>
          <ChangedIndicator changed={fieldChanged.status} className="w-48">
            <Combobox
              placeholder={t("statusLabel")}
              options={STATUS_VALUES.map((value) => ({ value, label: statusT(value) }))}
              value={status}
              onChange={(value) => setStatus(value as ComponentStatus)}
            />
          </ChangedIndicator>
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
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <ChangedIndicator changed={fieldChanged.manufacturer}>
            <input
              className="block w-full px-4 py-2 font-body-md text-body-md text-on-surface bg-surface-container border border-outline-variant rounded-lg focus:ring-1 focus:ring-primary focus:border-primary outline-none transition-colors"
              placeholder={t("manufacturerPlaceholder")}
              value={manufacturer}
              onChange={(e) => setManufacturer(e.target.value)}
            />
          </ChangedIndicator>
          <ChangedIndicator changed={fieldChanged.partNumber}>
            <input
              className="block w-full px-4 py-2 font-body-md text-body-md text-on-surface bg-surface-container border border-outline-variant rounded-lg focus:ring-1 focus:ring-primary focus:border-primary outline-none transition-colors font-mono-sm text-mono-sm"
              placeholder={t("partNumberPlaceholder")}
              value={partNumber}
              onChange={(e) => setPartNumber(e.target.value)}
            />
          </ChangedIndicator>
          <ChangedIndicator changed={fieldChanged.link}>
            <input
              type="url"
              className="block w-full px-4 py-2 font-body-md text-body-md text-on-surface bg-surface-container border border-outline-variant rounded-lg focus:ring-1 focus:ring-primary focus:border-primary outline-none transition-colors"
              placeholder={t("linkPlaceholder")}
              value={link}
              onChange={(e) => setLink(e.target.value)}
            />
          </ChangedIndicator>
          <ChangedIndicator changed={fieldChanged.quantityAvailable} className="flex items-center gap-3">
            <label className="font-body-md text-body-md text-on-surface-variant shrink-0">
              {t("quantityAvailableLabel")}
            </label>
            <input
              type="number"
              min={0}
              className="block w-full px-4 py-2 font-body-md text-body-md text-on-surface bg-surface-container border border-outline-variant rounded-lg focus:ring-1 focus:ring-primary focus:border-primary outline-none transition-colors"
              value={quantityAvailable}
              onChange={(e) => setQuantityAvailable(e.target.value)}
            />
          </ChangedIndicator>
        </div>
        {visibility === "RESTRICTED" && (
          <ChangedIndicator changed={fieldChanged.restrictedAccess}>
            <RestrictedAccessPicker
              initialGrants={component?.restricted_to ?? []}
              value={restrictedAccessDraft}
              onChange={setRestrictedAccessDraft}
            />
          </ChangedIndicator>
        )}
      </div>

      <ChangedIndicator changed={fieldChanged.summary}>
        <MarkdownEditor
          value={summary}
          onChange={setSummary}
          placeholder={t("summaryPlaceholder")}
          relateFrom={component ? { type: "component", id: component.id } : undefined}
        />
      </ChangedIndicator>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <ChangedIndicator changed={fieldChanged.specs} className="inline-block">
            <h3 className="font-label-caps text-label-caps text-on-surface-variant uppercase">{t("specificationsTitle")}</h3>
          </ChangedIndicator>
          <Button variant="ghost" onClick={() => setSpecs((prev) => [...prev, { label: "", value: "" }])}>
            <Icon name="add" size={16} />
            {t("addSpecButton")}
          </Button>
        </div>
        {specs.length === 0 ? (
          <p className="font-body-md text-body-md text-on-surface-variant">{t("noSpecsYet")}</p>
        ) : (
          <div className="space-y-2">
            {specs.map((row, index) => (
              <div key={index} className="flex items-center gap-2">
                <input
                  className="flex-1 px-3 py-2 font-body-md text-body-md text-on-surface bg-surface-container border border-outline-variant rounded-lg focus:ring-1 focus:ring-primary focus:border-primary outline-none transition-colors"
                  placeholder={t("specLabelPlaceholder")}
                  value={row.label}
                  onChange={(e) => updateSpecRow(index, "label", e.target.value)}
                />
                <input
                  className="flex-1 px-3 py-2 font-mono-sm text-mono-sm text-on-surface bg-surface-container border border-outline-variant rounded-lg focus:ring-1 focus:ring-primary focus:border-primary outline-none transition-colors"
                  placeholder={t("specValuePlaceholder")}
                  value={row.value}
                  onChange={(e) => updateSpecRow(index, "value", e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => removeSpecRow(index)}
                  aria-label={commonT("cancel")}
                  className="text-on-surface-variant hover:text-error transition-colors shrink-0"
                >
                  <Icon name="close" size={16} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {error && (
        <p className="font-body-md text-body-md text-error" role="alert">
          {error}
        </p>
      )}

      <div className="flex items-center gap-3">
        <Button onClick={handleSave} disabled={isSaving || !name.trim()}>
          {isSaving ? commonT("saving") : commonT("save")}
        </Button>
      </div>
    </div>
  );
}
