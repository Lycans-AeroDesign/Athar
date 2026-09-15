"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { IconButton } from "@/components/ui/IconButton";
import { createCourseCategory, deleteCourseCategory, listCourseCategories } from "@/lib/api/training";
import type { CourseCategory } from "@/lib/api/types";

// Course categories (training.models.CourseCategory) are deliberately their own
// model, not shared with knowledge.models.Category - see that model's own
// docstring. This is the one place both course creation's category picker and
// Settings' Categories tab manage them, so it's a shared component rather than
// duplicated add/delete logic in each caller.
export function CourseCategoryManager() {
  const t = useTranslations("training.manage");

  const [categories, setCategories] = useState<CourseCategory[]>([]);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [deleteCategoryId, setDeleteCategoryId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listCourseCategories().then(setCategories);
  }, []);

  async function handleAddCategory() {
    if (!newCategoryName.trim()) return;
    try {
      const category = await createCourseCategory({ name: newCategoryName.trim() });
      setCategories((prev) => [...prev, category]);
      setNewCategoryName("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleDeleteCategory() {
    if (!deleteCategoryId) return;
    await deleteCourseCategory(deleteCategoryId);
    setCategories((prev) => prev.filter((category) => category.id !== deleteCategoryId));
    setDeleteCategoryId(null);
  }

  return (
    <div className="space-y-3">
      {error && (
        <p className="font-body-md text-body-md text-error" role="alert">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {categories.map((category) => (
          <span
            key={category.id}
            className="flex items-center gap-1.5 pl-3 pr-1 py-1 rounded-full bg-surface-container-low border border-outline-variant font-body-md text-body-md text-on-surface"
          >
            {category.name}
            <IconButton
              icon="close"
              variant="ghost"
              size={14}
              aria-label={t("deleteCategoryConfirmTitle")}
              onClick={() => setDeleteCategoryId(category.id)}
            />
          </span>
        ))}
        {categories.length === 0 && (
          <p className="font-body-md text-body-md text-on-surface-variant">{t("noCourseCategories")}</p>
        )}
      </div>
      <div className="flex items-center gap-2 max-w-sm">
        <input
          className="flex-1 px-4 py-2 font-body-md text-body-md text-on-surface bg-surface border border-outline-variant rounded-lg focus:ring-1 focus:ring-primary focus:border-primary outline-none transition-colors"
          placeholder={t("categoryNamePlaceholder")}
          value={newCategoryName}
          onChange={(e) => setNewCategoryName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAddCategory()}
        />
        <Button variant="secondary" onClick={handleAddCategory} disabled={!newCategoryName.trim()}>
          {t("addCategoryButton")}
        </Button>
      </div>

      <ConfirmModal
        open={deleteCategoryId !== null}
        onOpenChange={(open) => !open && setDeleteCategoryId(null)}
        title={t("deleteCategoryConfirmTitle")}
        description={t("deleteCategoryConfirmBody")}
        danger
        onConfirm={handleDeleteCategory}
      />
    </div>
  );
}
