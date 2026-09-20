"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { FileDropzone } from "@/components/ui/FileDropzone";
import { Icon } from "@/components/ui/Icon";
import { Modal } from "@/components/ui/Modal";
import {
  downloadComponentImportTemplate,
  importComponentsCsv,
  type ComponentImportPreview,
  type ComponentImportRow,
  type ComponentImportRowAction,
} from "@/lib/api/engineering";

interface ComponentImportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
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
  error: "bg-error-container text-on-error-container",
};

// Backend field keys (see backend/knowledge/services.py's _build_field_changes)
// to their i18n label key suffix.
const FIELD_LABEL_KEYS: Record<string, string> = {
  category: "importFieldCategory",
  manufacturer: "importFieldManufacturer",
  part_number: "importFieldPartNumber",
  link: "importFieldLink",
  quantity_available: "importFieldQuantityAvailable",
  status: "importFieldStatus",
  visibility: "importFieldVisibility",
  tags: "importFieldTags",
  summary: "importFieldSummary",
  specifications: "importFieldSpecifications",
};

// Column set/validation/matching-by-name/diffing all live in
// backend/knowledge/services.py's import_components_csv - this modal is
// just the upload -> preview -> confirm surface over that two-phase API.
export function ComponentImportModal({ open, onOpenChange, onImported }: ComponentImportModalProps) {
  const t = useTranslations("engineering.component");
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [preview, setPreview] = useState<ComponentImportPreview | null>(null);
  const [isCommitting, setIsCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isCommitted = preview?.applied != null;
  const canConfirm = preview != null && !isCommitted && (preview.summary.create > 0 || preview.summary.update > 0);

  function reset() {
    setFile(null);
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

  async function handleFileSelected(selected: File) {
    setFile(selected);
    setPreview(null);
    setError(null);
    setProgress(0);
    try {
      setPreview(await importComponentsCsv(selected, false, setProgress));
    } catch (err) {
      setError(t("importError", { message: err instanceof Error ? err.message : String(err) }));
    } finally {
      setProgress(null);
    }
  }

  async function handleConfirm() {
    if (!file) return;
    setIsCommitting(true);
    setError(null);
    try {
      setPreview(await importComponentsCsv(file, true));
    } catch (err) {
      setError(t("importError", { message: err instanceof Error ? err.message : String(err) }));
    } finally {
      setIsCommitting(false);
    }
  }

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
            <Button onClick={handleConfirm} disabled={isCommitting}>
              {isCommitting ? t("importConfirmingButton") : t("importConfirmButton")}
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        <Button variant="secondary" onClick={handleDownloadTemplate}>
          <Icon name="download" size={16} />
          {t("downloadTemplateButton")}
        </Button>

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
            <ul className="max-h-64 overflow-y-auto space-y-2">
              {preview.rows.map((row) => (
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
        <span className="font-body-md text-body-md text-on-surface truncate">
          {row.name ?? t("importRowLabel", { row: row.row })}
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

      {changeEntries.length > 0 && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          {changeEntries.map(([field, change]) => (
            <div key={field} className="contents">
              <dt className="font-label-caps text-label-caps text-on-surface-variant uppercase">
                {t(FIELD_LABEL_KEYS[field] ?? field)}
              </dt>
              <dd className="font-body-md text-body-md text-on-surface">
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
