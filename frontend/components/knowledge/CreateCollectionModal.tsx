"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { INPUT_CLASS } from "@/components/ui/inputStyles";
import { createCollection } from "@/lib/api/collections";
import type { CollectionSummary } from "@/lib/api/types";
import { errorMessage } from "@/lib/errors";

interface CreateCollectionModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** New collections inherit the page's focus: the article-side pickers
   * create ARTICLE-scoped ones, the SOP side SOP-scoped ones (MIXED is a
   * deliberate choice, not a default). */
  defaultScope: "SOP" | "ARTICLE";
  onCreated: (collection: CollectionSummary) => void;
}

/** The only creation UI for Collections/Series - reachable from the
 * editors' collection picker and the list-page shelves (both gates already
 * match rendering: the picker is shown to collection.manage holders only,
 * and the shelves gate their "New" button with Can). Render nothing without
 * the permission - there is nothing meaningful to fill in. */
export function CreateCollectionModal({ open, onOpenChange, defaultScope, onCreated }: CreateCollectionModalProps) {
  const t = useTranslations("knowledge.collections");
  const [title, setTitle] = useState("");
  const [mode, setMode] = useState<"SERIES" | "FOLDER">("SERIES");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleDiscard() {
    setTitle("");
    setMode("SERIES");
    setError(null);
  }

  async function handleCreate() {
    if (!title.trim()) return;
    setIsSaving(true);
    setError(null);
    try {
      const collection = await createCollection({
        title: title.trim(),
        mode,
        content_scope: defaultScope,
      });
      // Reoriented to CollectionSummary (the detail payload is a superset).
      onCreated(collection);
      handleDiscard();
      onOpenChange(false);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={t("create.title")}
      isDirty={title.trim().length > 0 || mode !== "SERIES"}
      footer={
        <Button onClick={handleCreate} loading={isSaving} disabled={!title.trim()}>
          {t("create.createButton")}
        </Button>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1">
          <label className="block font-label-caps text-label-caps text-on-surface-variant uppercase">
            {t("create.nameLabel")}
          </label>
          <input
            className={INPUT_CLASS}
            placeholder={t("create.namePlaceholder")}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleCreate();
            }}
          />
        </div>
        <div className="space-y-1">
          <span className="block font-label-caps text-label-caps text-on-surface-variant uppercase">
            {t("create.typeLabel")}
          </span>
          <div className="flex gap-2">
            {(["SERIES", "FOLDER"] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setMode(option)}
                aria-pressed={mode === option}
                className={`flex-1 border rounded-lg px-3 py-2 font-body-md text-body-md transition-colors ${
                  mode === option
                    ? "bg-primary-container text-on-primary-container border-primary"
                    : "bg-surface-container text-on-surface-variant border-outline-variant hover:border-primary"
                }`}
              >
                {option === "SERIES" ? t("mode.SERIES") : t("mode.FOLDER")}
                <span className="block font-label-md text-label-md opacity-80">
                  {option === "SERIES" ? t("create.seriesDescription") : t("create.folderDescription")}
                </span>
              </button>
            ))}
          </div>
        </div>
        {error && (
          <p className="font-body-md text-body-md text-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
