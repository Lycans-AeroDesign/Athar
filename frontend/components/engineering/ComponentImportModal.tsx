"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { Combobox } from "@/components/ui/Combobox";
import { FileDropzone } from "@/components/ui/FileDropzone";
import { Icon } from "@/components/ui/Icon";
import { Modal } from "@/components/ui/Modal";
import {
  downloadComponentImportTemplate,
  importComponentsCsv,
  type ComponentImportOptions,
  type ComponentImportPreview,
  type ComponentImportRow,
  type ComponentImportRowAction,
} from "@/lib/api/engineering";
import type { InventoryType } from "@/lib/api/types";
import { INVENTORY_TYPE_VALUES } from "@/lib/inventory";
import { INVENTORY_TYPE_ICONS } from "@/lib/optionIcons";

interface ComponentImportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pre-selects which inventory sheet tab the file is from - the list page
   * passes its own type filter, since that's usually the tab being synced. */
  defaultInventoryType?: InventoryType | null;
  /** Called once the modal closes after a commit that actually created or
   * updated at least one component - lets the list page refetch without
   * polling/refetching on every open/close regardless of whether anything
   * actually happened. */
  onImported: () => void;
}

const ACTION_BADGE_CLASSES: Record<ComponentImportRowAction, string> = {
  create: "bg-primary-container text-on-primary-container",
  // Not tertiary-container - in this palette that's a red/rust hue (see
  // globals.css), which reads as an error/warning rather than a neutral
  // "this will change" preview state.
  update: "bg-secondary-container text-on-secondary-container",
  unchanged: "bg-surface-container-high text-on-surface-variant",
  merged: "bg-surface-container-high text-on-surface-variant",
  error: "bg-error-container text-on-error-container",
};

// Backend field keys (see backend/knowledge/services.py's _build_field_changes)
// to their i18n label key.
const FIELD_LABEL_KEYS: Record<string, string> = {
  name: "importFieldName",
  category: "importFieldCategory",
  location: "importFieldLocation",
  quantity_available: "importFieldQuantityAvailable",
  unit: "importFieldUnit",
  condition: "importFieldCondition",
  stock_status: "importFieldStockStatus",
  min_quantity: "importFieldMinQuantity",
  inventory_notes: "importFieldInventoryNotes",
  inventory_type: "importFieldInventoryType",
  manufacturer: "importFieldManufacturer",
  part_number: "importFieldPartNumber",
  link: "importFieldLink",
  status: "importFieldStatus",
  visibility: "importFieldVisibility",
  tags: "importFieldTags",
  summary: "importFieldSummary",
  specifications: "importFieldSpecifications",
};

// Column set/validation/matching/diffing all live in
// backend/knowledge/services.py's import_components_csv - this modal is
// just the upload -> preview -> confirm surface over that two-phase API.
export function ComponentImportModal({ open, onOpenChange, defaultInventoryType, onImported }: ComponentImportModalProps) {
  const t = useTranslations("engineering.component");
  const inventoryTypeT = useTranslations("engineering.inventoryType");
  const [file, setFile] = useState<File | null>(null);
  // null = not chosen by the user yet, so it follows defaultInventoryType.
  const [chosenInventoryType, setChosenInventoryType] = useState<InventoryType | "" | null>(null);
  const [duplicates, setDuplicates] = useState<"separate" | "merge">("separate");
  const [showAllRows, setShowAllRows] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [preview, setPreview] = useState<ComponentImportPreview | null>(null);
  const [isCommitting, setIsCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inventoryType = chosenInventoryType ?? defaultInventoryType ?? "";
  const isCommitted = preview?.applied != null;
  const canConfirm = preview != null && !isCommitted && (preview.summary.create > 0 || preview.summary.update > 0);

  function reset() {
    setFile(null);
    setChosenInventoryType(null);
    setDuplicates("separate");
    setShowAllRows(false);
    setProgress(null);
    setPreview(null);
    setError(null);
  }

  function handleOpenChange(next: boolean) {
    if (!next) {
      const applied = preview?.applied;
      if (applied && (applied.created > 0 || applied.updated > 0)) onImported();
      reset();
    }
    onOpenChange(next);
  }

  async function handleDownloadTemplate() {
    setError(null);
    try {
      await downloadComponentImportTemplate();
    } catch (err) {
      setError(t("downloadTemplateError", { message: err instanceof Error ? err.message : String(err) }));
    }
  }

  async function runPreview(selected: File, options: ComponentImportOptions) {
    setPreview(null);
    setError(null);
    setProgress(0);
    try {
      setPreview(await importComponentsCsv(selected, false, options, setProgress));
    } catch (err) {
      setError(t("importError", { message: err instanceof Error ? err.message : String(err) }));
    } finally {
      setProgress(null);
    }
  }

  function currentOptions(overrides?: Partial<{ inventoryType: InventoryType | ""; duplicates: "separate" | "merge" }>) {
    const type = overrides?.inventoryType ?? inventoryType;
    return { inventoryType: type || undefined, duplicates: overrides?.duplicates ?? duplicates };
  }

  function handleFileSelected(selected: File) {
    setFile(selected);
    void runPreview(selected, currentOptions());
  }

  // Both options change what the preview shows, so a new choice re-runs it
  // against the same file rather than leaving a stale diff on screen.
  function handleInventoryTypeChange(value: InventoryType | "") {
    setChosenInventoryType(value);
    if (file && !isCommitted) void runPreview(file, currentOptions({ inventoryType: value }));
  }

  function handleDuplicatesChange(value: "separate" | "merge") {
    setDuplicates(value);
    if (file && !isCommitted) void runPreview(file, currentOptions({ duplicates: value }));
  }

  async function handleConfirm() {
    if (!file) return;
    setIsCommitting(true);
    setError(null);
    try {
      setPreview(await importComponentsCsv(file, true, currentOptions()));
    } catch (err) {
      setError(t("importError", { message: err instanceof Error ? err.message : String(err) }));
    } finally {
      setIsCommitting(false);
    }
  }

  // By default only rows that need a look - changes, errors, warnings - so a
  // re-sync of a 70-row tab doesn't bury the 3 rows that actually changed.
  const visibleRows =
    preview?.rows.filter((row) => showAllRows || (row.action !== "unchanged" && row.action !== "merged") || row.warnings.length > 0) ??
    [];

  return (
    <Modal
      open={open}
      onOpenChange={handleOpenChange}
      title={t("importModalTitle")}
      description={t("importModalDescription")}
      footer={
        <>
          <Button variant="secondary" onClick={() => handleOpenChange(false)}>
            {t("importDoneButton")}
          </Button>
          {canConfirm && (
            <Button onClick={handleConfirm} disabled={isCommitting || progress !== null}>
              {isCommitting ? t("importConfirmingButton") : t("importConfirmButton")}
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-60">
            <Combobox
              label={t("importInventoryTypeLabel")}
              options={[
                { value: "", label: inventoryTypeT("fromFile") },
                ...INVENTORY_TYPE_VALUES.map((value) => ({
                  value,
                  label: inventoryTypeT(value),
                  ...INVENTORY_TYPE_ICONS[value],
                })),
              ]}
              value={inventoryType}
              onChange={(value) => handleInventoryTypeChange(value as InventoryType | "")}
            />
          </div>
          <Button variant="secondary" onClick={handleDownloadTemplate}>
            <Icon name="download" size={16} />
            {t("downloadTemplateButton")}
          </Button>
        </div>

        <p className="font-body-md text-body-md text-on-surface-variant">{t("importAtharIdTip")}</p>

        <FileDropzone
          label={t("importDropzoneLabel")}
          fileName={file?.name ?? null}
          progress={progress}
          disabled={isCommitting}
          onFileSelected={handleFileSelected}
        />

        {error && (
          <p className="font-body-md text-body-md text-error" role="alert">
            {error}
          </p>
        )}

        {preview && preview.summary.duplicate_groups > 0 && !isCommitted && (
          <fieldset className="space-y-2 rounded-lg border border-outline-variant p-3">
            <legend className="px-1 font-label-caps text-label-caps text-on-surface-variant uppercase">
              {t("importDuplicatesTitle", { count: preview.summary.duplicate_groups })}
            </legend>
            {(["separate", "merge"] as const).map((value) => (
              <label key={value} className="flex items-start gap-2 font-body-md text-body-md text-on-surface">
                <input
                  type="radio"
                  name="import-duplicates"
                  className="mt-1"
                  checked={duplicates === value}
                  onChange={() => handleDuplicatesChange(value)}
                  disabled={progress !== null}
                />
                <span>
                  {t(value === "separate" ? "importDuplicatesSeparate" : "importDuplicatesMerge")}
                  <span className="block text-on-surface-variant">
                    {t(value === "separate" ? "importDuplicatesSeparateHelp" : "importDuplicatesMergeHelp")}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
        )}

        {preview && (
          <div className="space-y-3">
            <p className="font-body-md text-body-md text-on-surface">
              {isCommitted && preview.applied
                ? t("importAppliedSummary", preview.applied)
                : t("importPreviewSummary", preview.summary)}
            </p>
            {!isCommitted && !canConfirm && preview.rows.length > 0 && (
              <p className="font-body-md text-body-md text-on-surface-variant">{t("importNothingToApply")}</p>
            )}
            {preview.rows.length > 0 && (
              <label className="flex items-center gap-2 font-body-md text-body-md text-on-surface-variant">
                <input type="checkbox" checked={showAllRows} onChange={(e) => setShowAllRows(e.target.checked)} />
                {t("importShowAllRows", { count: preview.rows.length })}
              </label>
            )}
            <ul className="max-h-72 overflow-y-auto space-y-2">
              {visibleRows.map((row) => (
                <ImportRowCard key={row.row} row={row} />
              ))}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  );
}

function ImportRowCard({ row }: { row: ComponentImportRow }) {
  const t = useTranslations("engineering.component");
  const changeEntries = row.changes ? Object.entries(row.changes) : [];

  return (
    <li className="rounded-lg border border-outline-variant p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 font-body-md text-body-md text-on-surface truncate">
          <span className="font-mono-sm text-mono-sm text-on-surface-variant me-2">{t("importRowLabel", { row: row.row })}</span>
          {row.name}
        </span>
        <span
          className={`font-label-caps text-label-caps uppercase rounded-full px-2.5 py-1 shrink-0 ${ACTION_BADGE_CLASSES[row.action]}`}
        >
          {t(`importAction${capitalize(row.action)}`)}
        </span>
      </div>

      {row.action === "error" && row.message && (
        <p className="font-body-md text-body-md text-error">{t("importRowError", { row: row.row, message: row.message })}</p>
      )}
      {row.action === "merged" && row.merged_into != null && (
        <p className="font-body-md text-body-md text-on-surface-variant">{t("importMergedInto", { row: row.merged_into })}</p>
      )}
      {row.warnings.map((warning) => (
        <p key={warning} className="flex items-start gap-1 font-body-md text-body-md text-on-surface-variant">
          <Icon name="report_problem" size={14} className="mt-1 shrink-0" />
          {warning}
        </p>
      ))}

      {changeEntries.length > 0 && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          {changeEntries.map(([field, change]) => (
            <div key={field} className="contents">
              <dt className="font-label-caps text-label-caps text-on-surface-variant uppercase">
                {FIELD_LABEL_KEYS[field] ? t(FIELD_LABEL_KEYS[field]) : field}
              </dt>
              <dd className="font-body-md text-body-md text-on-surface wrap-anywhere">
                {change.old ? (
                  <>
                    <span className="text-on-surface-variant line-through">{change.old}</span>
                    {" → "}
                  </>
                ) : null}
                {change.new}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </li>
  );
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
