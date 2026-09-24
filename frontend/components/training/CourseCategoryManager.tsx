"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Icon } from "@/components/ui/Icon";
import { Modal } from "@/components/ui/Modal";
import {
  createCourseCategory,
  deleteCourseCategory,
  listCourseCategories,
  updateCourseCategory,
} from "@/lib/api/training";
import type { CourseCategory } from "@/lib/api/types";

// Course categories (training.models.CourseCategory) are deliberately their own
// model, not shared with knowledge.models.Category - see that model's own
// docstring. This is the one place both Training's manage page and Settings'
// Categories tab manage them, so it's a shared component rather than duplicated
// create/rename/delete logic in each caller. Its layout and workflow mirror
// CategorySettingsForm (the Knowledge categories) so the two read as one pattern.
export function CourseCategoryManager() {
  const t = useTranslations("training.manage");
  const categoriesT = useTranslations("settings.categories");
  const commonT = useTranslations("common");

  const [categories, setCategories] = useState<CourseCategory[] | null>(null);
  // null while the modal is closed; "new" for the create flow; a CourseCategory while renaming it.
  const [editTarget, setEditTarget] = useState<CourseCategory | "new" | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CourseCategory | null>(null);

  useEffect(() => {
    listCourseCategories().then(setCategories);
  }, []);

  function openCreate() {
    setEditTarget("new");
    setName("");
    setDescription("");
    setSaveError(null);
  }

  function openRename(category: CourseCategory) {
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
        const created = await createCourseCategory({ name: name.trim(), description: description.trim() });
        setCategories((prev) => [...(prev ?? []), created].sort((a, b) => a.name.localeCompare(b.name)));
      } else if (editTarget) {
        const updated = await updateCourseCategory(editTarget.id, {
          name: name.trim(),
          description: description.trim(),
        });
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
    await deleteCourseCategory(deleteTarget.id);
    setCategories((prev) => (prev ?? []).filter((category) => category.id !== deleteTarget.id));
  }

  return (
    <div className="max-w-2xl">
      <div className="bg-surface rounded-xl border border-outline-variant p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 className="font-headline-md text-headline-md text-on-surface">{t("categoriesTitle")}</h2>
            <p className="font-body-md text-body-md text-on-surface-variant mt-1">{t("categoriesDescription")}</p>
          </div>
          <Button onClick={openCreate}>
            <Icon name="add" size={18} />
            {categoriesT("newCategory")}
          </Button>
        </div>

        {!categories ? (
          <p className="font-body-md text-body-md text-on-surface-variant">{commonT("loading")}</p>
        ) : categories.length === 0 ? (
          <p className="font-body-md text-body-md text-on-surface-variant">{t("noCourseCategories")}</p>
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
                    {t("courseCount", { count: category.course_count })}
                  </span>
                  <button
                    type="button"
                    onClick={() => setDeleteTarget(category)}
                    aria-label={categoriesT("deleteCategory")}
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
        title={editTarget === "new" ? categoriesT("newCategory") : categoriesT("renameCategory")}
        isDirty={
          editTarget === "new"
            ? name.length > 0 || description.length > 0
            : name !== editTarget?.name || description !== editTarget?.description
        }
        footer={
          <Button onClick={handleSave} disabled={isSaving || !name.trim()}>
            {isSaving ? commonT("saving") : editTarget === "new" ? categoriesT("createCategory") : commonT("save")}
          </Button>
        }
      >
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="block font-label-caps text-label-caps text-on-surface-variant uppercase">
              {categoriesT("nameLabel")}
            </label>
            <input
              className="block w-full px-4 py-2 font-body-md text-body-md text-on-surface bg-surface-container border border-outline-variant rounded-lg focus:ring-1 focus:ring-primary focus:border-primary outline-none transition-colors"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <label className="block font-label-caps text-label-caps text-on-surface-variant uppercase">
              {categoriesT("descriptionLabel")}
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
        title={t("deleteCategoryConfirmTitle", { name: deleteTarget?.name ?? "" })}
        description={t("deleteCategoryConfirmBody")}
        confirmLabel={categoriesT("deleteCategory")}
        danger
        onConfirm={handleDelete}
      />
    </div>
  );
}
