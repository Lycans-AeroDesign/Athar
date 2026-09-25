"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Icon } from "@/components/ui/Icon";
import { Modal } from "@/components/ui/Modal";
import {
  createComponentCategory,
  createStorageLocation,
  deleteComponentCategory,
  deleteStorageLocation,
  getComponentCategories,
  getStorageLocations,
  updateComponentCategory,
  updateStorageLocation,
} from "@/lib/api/engineering";

interface ListEntry {
  id: string;
  name: string;
  description: string;
  component_count: number;
}

interface ListApi {
  list: () => Promise<ListEntry[]>;
  create: (payload: { name: string; description: string }) => Promise<ListEntry>;
  update: (id: string, payload: { name: string; description: string }) => Promise<ListEntry>;
  remove: (id: string) => Promise<void>;
}

const APIS: Record<"categories" | "locations", ListApi> = {
  categories: {
    list: getComponentCategories,
    create: createComponentCategory,
    update: updateComponentCategory,
    remove: deleteComponentCategory,
  },
  locations: {
    list: getStorageLocations,
    create: createStorageLocation,
    update: updateStorageLocation,
    remove: deleteStorageLocation,
  },
};

// Settings > Categories' managers for the two workshop-inventory lists -
// components' own categories and their storage locations. Same layout and
// create/rename/delete workflow as CategorySettingsForm/CourseCategoryManager
// so every category-like list in Settings reads as one pattern. New entries
// also appear on their own (typed into the component editor, or from a CSV
// import) - this is where they get tidied up.
export function InventoryListManager({ kind }: { kind: "categories" | "locations" }) {
  const categoriesT = useTranslations("settings.componentCategories");
  const locationsT = useTranslations("settings.storageLocations");
  const t = kind === "categories" ? categoriesT : locationsT;
  const commonT = useTranslations("common");
  const api = APIS[kind];

  const [entries, setEntries] = useState<ListEntry[] | null>(null);
  // null while the modal is closed; "new" for the create flow; an entry while renaming it.
  const [editTarget, setEditTarget] = useState<ListEntry | "new" | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ListEntry | null>(null);

  useEffect(() => {
    api.list().then(setEntries);
  }, [api]);

  function openCreate() {
    setEditTarget("new");
    setName("");
    setDescription("");
    setSaveError(null);
  }

  function openRename(entry: ListEntry) {
    setEditTarget(entry);
    setName(entry.name);
    setDescription(entry.description);
    setSaveError(null);
  }

  async function handleSave() {
    setIsSaving(true);
    setSaveError(null);
    try {
      if (editTarget === "new") {
        await api.create({ name: name.trim(), description: description.trim() });
      } else if (editTarget) {
        await api.update(editTarget.id, { name: name.trim(), description: description.trim() });
      }
      // Refetch rather than patching locally: renaming a location onto
      // another one merges the two, which changes more than one row.
      setEntries(await api.list());
      setEditTarget(null);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    await api.remove(deleteTarget.id);
    setEntries((prev) => (prev ?? []).filter((entry) => entry.id !== deleteTarget.id));
  }

  return (
    <div className="max-w-2xl">
      <div className="bg-surface rounded-xl border border-outline-variant p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 className="font-headline-md text-headline-md text-on-surface">{t("title")}</h2>
            <p className="font-body-md text-body-md text-on-surface-variant mt-1">{t("description")}</p>
          </div>
          <Button onClick={openCreate}>
            <Icon name="add" size={18} />
            {t("newButton")}
          </Button>
        </div>

        {!entries ? (
          <p className="font-body-md text-body-md text-on-surface-variant">{commonT("loading")}</p>
        ) : entries.length === 0 ? (
          <p className="font-body-md text-body-md text-on-surface-variant">{t("emptyState")}</p>
        ) : (
          <ul className="space-y-1 max-h-96 overflow-y-auto">
            {entries.map((entry) => (
              <li key={entry.id} className="flex items-center justify-between gap-4 px-3 py-2 rounded-lg bg-surface-container">
                <button type="button" onClick={() => openRename(entry)} className="min-w-0 text-start flex-1">
                  <p className="font-body-md text-body-md text-on-surface truncate">{entry.name}</p>
                  {entry.description && (
                    <p className="font-body-md text-body-md text-on-surface-variant truncate">{entry.description}</p>
                  )}
                </button>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="font-mono-sm text-mono-sm text-on-surface-variant">
                    {t("componentCount", { count: entry.component_count })}
                  </span>
                  <button
                    type="button"
                    onClick={() => setDeleteTarget(entry)}
                    aria-label={t("deleteButton")}
                    className="text-on-surface-variant hover:text-error transition-colors"
                  >
                    <Icon name="delete" size={18} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Modal
        open={editTarget !== null}
        onOpenChange={(isOpen) => !isOpen && setEditTarget(null)}
        title={editTarget === "new" ? t("newButton") : t("renameTitle")}
        isDirty={
          editTarget === "new"
            ? name.length > 0 || description.length > 0
            : name !== editTarget?.name || description !== editTarget?.description
        }
        footer={
          <Button onClick={handleSave} disabled={isSaving || !name.trim()}>
            {isSaving ? commonT("saving") : editTarget === "new" ? t("createButton") : commonT("save")}
          </Button>
        }
      >
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="block font-label-caps text-label-caps text-on-surface-variant uppercase">{t("nameLabel")}</label>
            <input
              className="block w-full px-4 py-2 font-body-md text-body-md text-on-surface bg-surface-container border border-outline-variant rounded-lg focus:ring-1 focus:ring-primary focus:border-primary outline-none transition-colors"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            {kind === "locations" && editTarget !== "new" && (
              <p className="font-body-md text-body-md text-on-surface-variant">{t("mergeHint")}</p>
            )}
          </div>
          <div className="space-y-2">
            <label className="block font-label-caps text-label-caps text-on-surface-variant uppercase">
              {t("descriptionLabel")}
            </label>
            <input
              className="block w-full px-4 py-2 font-body-md text-body-md text-on-surface bg-surface-container border border-outline-variant rounded-lg focus:ring-1 focus:ring-primary focus:border-primary outline-none transition-colors"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          {saveError && (
            <p className="font-body-md text-body-md text-error" role="alert">
              {saveError}
            </p>
          )}
        </div>
      </Modal>

      <ConfirmModal
        open={deleteTarget !== null}
        onOpenChange={(isOpen) => !isOpen && setDeleteTarget(null)}
        title={t("deleteConfirmTitle", { name: deleteTarget?.name ?? "" })}
        description={t("deleteConfirmBody")}
        confirmLabel={t("deleteButton")}
        danger
        onConfirm={handleDelete}
      />
    </div>
  );
}
