"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Icon } from "@/components/ui/Icon";
import { Modal } from "@/components/ui/Modal";
import { createCategory, deleteCategory, getCategories, updateCategory } from "@/lib/api/knowledge";
import type { Category } from "@/lib/api/types";

// Rendered only when the viewer has category.manage (see settings/page.tsx),
// which also gates the underlying POST/PATCH/DELETE endpoints - see
// CategoryListView/CategoryDetailView in backend/knowledge/views.py. Unlike
// RolesSettingsForm there's no staged-draft/Save step: name+description is
// all a category has, so create/rename/delete just call the API directly.
export function CategorySettingsForm() {
  const t = useTranslations("settings.categories");
  const commonT = useTranslations("common");

  const [categories, setCategories] = useState<Category[] | null>(null);
  // null while the modal is closed; "new" for the create flow; a Category while renaming it.
  const [editTarget, setEditTarget] = useState<Category | "new" | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Category | null>(null);

  useEffect(() => {
    getCategories().then(setCategories);
  }, []);

  function openCreate() {
    setEditTarget("new");
    setName("");
    setDescription("");
    setSaveError(null);
  }

  function openRename(category: Category) {
    setEditTarget(category);
    setName(category.name);
    setDescription(category.description);
    setSaveError(null);
  }

  async function handleSave() {
    setIsSaving(true);
    setSaveError(null);
    try {
      if (editTarget === "new") {
        const created = await createCategory({ name: name.trim(), description: description.trim() });
        setCategories((prev) => [...(prev ?? []), created].sort((a, b) => a.name.localeCompare(b.name)));
      } else if (editTarget) {
        const updated = await updateCategory(editTarget.id, { name: name.trim(), description: description.trim() });
        setCategories((prev) =>
          (prev ?? []).map((category) => (category.id === updated.id ? updated : category)),
        );
      }
      setEditTarget(null);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    await deleteCategory(deleteTarget.id);
    setCategories((prev) => (prev ?? []).filter((category) => category.id !== deleteTarget.id));
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="bg-surface rounded-xl border border-outline-variant p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 className="font-headline-md text-headline-md text-on-surface">{t("title")}</h2>
            <p className="font-body-md text-body-md text-on-surface-variant mt-1">{t("description")}</p>
          </div>
          <Button onClick={openCreate}>
            <Icon name="add" size={18} />
            {t("newCategory")}
          </Button>
        </div>

        {!categories ? (
          <p className="font-body-md text-body-md text-on-surface-variant">{commonT("loading")}</p>
        ) : categories.length === 0 ? (
          <p className="font-body-md text-body-md text-on-surface-variant">{t("emptyState")}</p>
        ) : (
          <ul className="space-y-1">
            {categories.map((category) => (
              <li
                key={category.id}
                className="flex items-center justify-between gap-4 px-3 py-2 rounded-lg bg-surface-container"
              >
                <button
                  type="button"
                  onClick={() => openRename(category)}
                  className="min-w-0 text-start flex-1"
                >
                  <p className="font-body-md text-body-md text-on-surface truncate">{category.name}</p>
                  {category.description && (
                    <p className="font-body-md text-body-md text-on-surface-variant truncate">
                      {category.description}
                    </p>
                  )}
                </button>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="font-mono-sm text-mono-sm text-on-surface-variant">
                    {t("articleCount", { count: category.article_count })}
                  </span>
                  <button
                    type="button"
                    onClick={() => setDeleteTarget(category)}
                    aria-label={t("deleteCategory")}
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
        onOpenChange={(open) => !open && setEditTarget(null)}
        title={editTarget === "new" ? t("newCategory") : t("renameCategory")}
        isDirty={
          editTarget === "new" ? name.length > 0 || description.length > 0 : name !== editTarget?.name || description !== editTarget?.description
        }
        footer={
          <Button onClick={handleSave} disabled={isSaving || !name.trim()}>
            {isSaving ? commonT("saving") : editTarget === "new" ? t("createCategory") : commonT("save")}
          </Button>
        }
      >
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="block font-label-caps text-label-caps text-on-surface-variant uppercase">
              {t("nameLabel")}
            </label>
            <input
              className="block w-full px-4 py-2 font-body-md text-body-md text-on-surface bg-surface-container border border-outline-variant rounded-lg focus:ring-1 focus:ring-primary focus:border-primary outline-none transition-colors"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
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
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={t("deleteConfirmTitle", { name: deleteTarget?.name ?? "" })}
        description={t("deleteConfirmBody")}
        confirmLabel={t("deleteCategory")}
        danger
        onConfirm={handleDelete}
      />
    </div>
  );
}
