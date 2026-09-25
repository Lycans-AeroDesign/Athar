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
import {
  createComponent,
  getComponentCategories,
  getStorageLocations,
  updateComponent,
  type ComponentWritePayload,
} from "@/lib/api/engineering";
import { uploadFile } from "@/lib/api/files";
import type {
  ComponentCategory,
  ComponentCondition,
  ComponentDetail,
  ComponentSpecRow,
  ComponentStatus,
  InventoryType,
  StockStatus,
  StorageLocation,
  StoredFileRef,
  Visibility,
} from "@/lib/api/types";
import { CONDITION_VALUES, INVENTORY_TYPE_VALUES, STOCK_STATUS_VALUES, UNIT_SUGGESTIONS } from "@/lib/inventory";
import {
  COMPONENT_STATUS_ICONS,
  CONDITION_ICONS,
  INVENTORY_TYPE_ICONS,
  STOCK_STATUS_ICONS,
  VISIBILITY_ICONS,
} from "@/lib/optionIcons";

const STATUS_VALUES: ComponentStatus[] = ["CERTIFIED", "TESTING", "DEPRECATED"];
const VISIBILITY_VALUES: Visibility[] = ["PUBLIC", "RESTRICTED"];

const INPUT_CLASS =
  "block w-full px-4 py-2 font-body-md text-body-md text-on-surface bg-surface-container border border-outline-variant rounded-lg focus:ring-1 focus:ring-primary focus:border-primary outline-none transition-colors";
const FIELD_LABEL_CLASS = "block font-label-caps text-label-caps text-on-surface-variant uppercase mb-2";

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
  const stockT = useTranslations("engineering.stockStatus");
  const conditionT = useTranslations("engineering.componentCondition");
  const inventoryTypeT = useTranslations("engineering.inventoryType");
  const router = useRouter();

  const [categories, setCategories] = useState<ComponentCategory[]>([]);
  const [locations, setLocations] = useState<StorageLocation[]>([]);
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
  const [status, setStatus] = useState<ComponentStatus | "">(component?.status ?? "TESTING");
  const [inventoryType, setInventoryType] = useState<InventoryType | "">(component?.inventory_type ?? "");
  const [locationName, setLocationName] = useState(component?.location?.name ?? "");
  const [unit, setUnit] = useState(component?.unit ?? "");
  const [condition, setCondition] = useState<ComponentCondition | "">(component?.condition ?? "");
  // "" = automatic (worked out from the quantity by the backend).
  const [stockStatus, setStockStatus] = useState<StockStatus | "">(component?.stock_status ?? "");
  // Raw text, like quantityAvailable - "" means no minimum.
  const [minQuantity, setMinQuantity] = useState(component?.min_quantity == null ? "" : String(component.min_quantity));
  const [inventoryNotes, setInventoryNotes] = useState(component?.inventory_notes ?? "");
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
    getComponentCategories().then(setCategories);
    getStorageLocations().then(setLocations);
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
    inventoryType: inventoryType !== (component?.inventory_type ?? ""),
    location: locationName.trim() !== (component?.location?.name ?? ""),
    unit: unit !== (component?.unit ?? ""),
    condition: condition !== (component?.condition ?? ""),
    stockStatus: stockStatus !== (component?.stock_status ?? ""),
    minQuantity: parseMinQuantity(minQuantity) !== (component?.min_quantity ?? null),
    inventoryNotes: inventoryNotes !== (component?.inventory_notes ?? ""),
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
    const payload: ComponentWritePayload = {
      name,
      category_id: categoryId,
      photo_id: photo?.id ?? null,
      manufacturer,
      part_number: partNumber,
      link,
      quantity_available: Math.max(0, Number(quantityAvailable) || 0),
      status,
      inventory_type: inventoryType,
      location_name: locationName.trim(),
      unit: unit.trim(),
      condition,
      min_quantity: parseMinQuantity(minQuantity),
      inventory_notes: inventoryNotes,
      summary,
      specifications: specs.filter((row) => row.label.trim() || row.value.trim()),
      visibility,
      tag_names: tags,
    };
    // Only sent when actually picked - left alone, the backend keeps an
    // automatic status following the quantity (see ComponentWritePayload).
    if (fieldChanged.stockStatus) payload.stock_status = stockStatus;
    return payload;
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
              options={[
                { value: "", label: statusT("notSet") },
                ...STATUS_VALUES.map((value) => ({ value, label: statusT(value), ...COMPONENT_STATUS_ICONS[value] })),
              ]}
              value={status}
              onChange={(value) => setStatus(value as ComponentStatus | "")}
            />
          </ChangedIndicator>
          <ChangedIndicator changed={fieldChanged.tags} className="flex-1 min-w-[200px]">
            <TagInput value={tags} onChange={setTags} placeholder={t("tagsPlaceholder")} className="w-full" />
          </ChangedIndicator>
          <ChangedIndicator changed={fieldChanged.visibility} className="w-48">
            <Combobox
              placeholder={t("visibilityLabel")}
              options={VISIBILITY_VALUES.map((value) => ({ value, label: t(`visibility${value}`), ...VISIBILITY_ICONS[value] }))}
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

      <section className="space-y-4 rounded-xl border border-outline-variant bg-surface-container-lowest p-4">
        <div className="flex items-center gap-2">
          <Icon name="inventory" size={18} className="text-on-surface-variant" />
          <h3 className="font-label-caps text-label-caps text-on-surface-variant uppercase">{t("inventoryTitle")}</h3>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <ChangedIndicator changed={fieldChanged.inventoryType}>
            <Combobox
              label={t("inventoryTypeLabel")}
              options={[
                { value: "", label: inventoryTypeT("none") },
                ...INVENTORY_TYPE_VALUES.map((value) => ({
                  value,
                  label: inventoryTypeT(value),
                  ...INVENTORY_TYPE_ICONS[value],
                })),
              ]}
              value={inventoryType}
              onChange={(value) => setInventoryType(value as InventoryType | "")}
            />
          </ChangedIndicator>
          <ChangedIndicator changed={fieldChanged.location} className="sm:col-span-1 lg:col-span-2">
            <label className={FIELD_LABEL_CLASS} htmlFor="component-location">
              {t("locationLabel")}
            </label>
            <input
              id="component-location"
              list="component-location-options"
              className={INPUT_CLASS}
              placeholder={t("locationPlaceholder")}
              value={locationName}
              onChange={(e) => setLocationName(e.target.value)}
            />
            <datalist id="component-location-options">
              {locations.map((location) => (
                <option key={location.id} value={location.name} />
              ))}
            </datalist>
          </ChangedIndicator>
          <ChangedIndicator changed={fieldChanged.quantityAvailable}>
            <label className={FIELD_LABEL_CLASS} htmlFor="component-quantity">
              {t("quantityAvailableLabel")}
            </label>
            <input
              id="component-quantity"
              type="number"
              min={0}
              className={INPUT_CLASS}
              value={quantityAvailable}
              onChange={(e) => setQuantityAvailable(e.target.value)}
            />
          </ChangedIndicator>
          <ChangedIndicator changed={fieldChanged.unit}>
            <label className={FIELD_LABEL_CLASS} htmlFor="component-unit">
              {t("unitLabel")}
            </label>
            <input
              id="component-unit"
              list="component-unit-options"
              className={INPUT_CLASS}
              placeholder={t("unitPlaceholder")}
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
            />
            <datalist id="component-unit-options">
              {UNIT_SUGGESTIONS.map((value) => (
                <option key={value} value={value} />
              ))}
            </datalist>
          </ChangedIndicator>
          <ChangedIndicator changed={fieldChanged.minQuantity}>
            <label className={FIELD_LABEL_CLASS} htmlFor="component-min-quantity">
              {t("minQuantityLabel")}
            </label>
            <input
              id="component-min-quantity"
              type="number"
              min={0}
              className={INPUT_CLASS}
              placeholder={t("minQuantityPlaceholder")}
              value={minQuantity}
              onChange={(e) => setMinQuantity(e.target.value)}
            />
          </ChangedIndicator>
          <ChangedIndicator changed={fieldChanged.condition}>
            <Combobox
              label={t("conditionLabel")}
              options={[
                { value: "", label: conditionT("none") },
                ...CONDITION_VALUES.map((value) => ({ value, label: conditionT(value), ...CONDITION_ICONS[value] })),
              ]}
              value={condition}
              onChange={(value) => setCondition(value as ComponentCondition | "")}
            />
          </ChangedIndicator>
          <ChangedIndicator changed={fieldChanged.stockStatus} className="lg:col-span-2">
            <Combobox
              label={t("stockStatusLabel")}
              options={[
                { value: "", label: stockT("automatic"), icon: "auto_awesome" },
                ...STOCK_STATUS_VALUES.map((value) => ({ value, label: stockT(value), ...STOCK_STATUS_ICONS[value] })),
              ]}
              value={stockStatus}
              onChange={(value) => setStockStatus(value as StockStatus | "")}
            />
            <p className="mt-1 font-body-md text-body-md text-on-surface-variant">{t("stockStatusHelp")}</p>
          </ChangedIndicator>
          <ChangedIndicator changed={fieldChanged.inventoryNotes} className="sm:col-span-2 lg:col-span-3">
            <label className={FIELD_LABEL_CLASS} htmlFor="component-inventory-notes">
              {t("inventoryNotesLabel")}
            </label>
            <textarea
              id="component-inventory-notes"
              rows={2}
              className={INPUT_CLASS}
              placeholder={t("inventoryNotesPlaceholder")}
              value={inventoryNotes}
              onChange={(e) => setInventoryNotes(e.target.value)}
            />
          </ChangedIndicator>
        </div>
      </section>

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
        <Button onClick={handleSave} disabled={isSaving || !name.trim() || (!!component && !isDirty)}>
          {isSaving ? commonT("saving") : commonT("save")}
        </Button>
      </div>
    </div>
  );
}

function parseMinQuantity(raw: string): number | null {
  if (!raw.trim()) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
}
