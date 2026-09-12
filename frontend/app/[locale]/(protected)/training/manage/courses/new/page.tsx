"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Combobox } from "@/components/ui/Combobox";
import { Icon } from "@/components/ui/Icon";
import { Link, useRouter } from "@/i18n/navigation";
import { createCourse, listCourseCategories } from "@/lib/api/training";
import type { CourseCategory, CourseDifficulty } from "@/lib/api/types";

const DIFFICULTIES: CourseDifficulty[] = ["BEGINNER", "INTERMEDIATE", "ADVANCED"];

export default function NewCoursePage() {
  const t = useTranslations("training.manage");
  const difficultyT = useTranslations("training.difficulty");
  const router = useRouter();

  const [categories, setCategories] = useState<CourseCategory[]>([]);
  const [title, setTitle] = useState("");
  const [shortDescription, setShortDescription] = useState("");
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [difficulty, setDifficulty] = useState<CourseDifficulty>("BEGINNER");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listCourseCategories().then(setCategories);
  }, []);

  async function handleCreate() {
    setIsSaving(true);
    setError(null);
    try {
      const course = await createCourse({
        title,
        short_description: shortDescription,
        description,
        category_id: categoryId,
        difficulty,
      });
      router.push(`/training/manage/courses/${course.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setIsSaving(false);
    }
  }

  return (
    <div className="max-w-[700px] mx-auto space-y-6">
      <Link
        href="/training/manage"
        className="inline-flex items-center gap-1 font-label-caps text-label-caps uppercase text-on-surface-variant hover:text-on-surface transition-colors"
      >
        <Icon name="arrow_back" size={16} />
        {t("backToManage")}
      </Link>

      <h1 className="font-display text-display text-on-surface">{t("createCourseButton")}</h1>

      <div className="space-y-4 bg-surface-container-low border border-outline-variant rounded-xl p-6">
        <input
          className="w-full font-headline-lg text-headline-lg font-bold border-none bg-transparent placeholder:text-on-surface-variant/50 focus:ring-0 p-0 text-on-surface outline-none"
          placeholder={t("titlePlaceholder")}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <input
          className="w-full bg-transparent border-none font-body-md text-body-md text-on-surface-variant placeholder:text-on-surface-variant/50 focus:ring-0 p-0 outline-none"
          placeholder={t("shortDescriptionPlaceholder")}
          value={shortDescription}
          onChange={(e) => setShortDescription(e.target.value)}
        />
        <textarea
          className="block w-full min-h-[120px] px-4 py-2 font-body-md text-body-md text-on-surface bg-surface border border-outline-variant rounded-lg focus:ring-1 focus:ring-primary focus:border-primary outline-none transition-colors"
          placeholder={t("descriptionPlaceholder")}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <div className="flex flex-wrap gap-3">
          <div className="w-56">
            <Combobox
              label={t("difficultyLabel")}
              options={DIFFICULTIES.map((value) => ({ value, label: difficultyT(value) }))}
              value={difficulty}
              onChange={(value) => setDifficulty(value as CourseDifficulty)}
            />
          </div>
          <div className="w-56">
            <Combobox
              label={t("categoryLabel")}
              placeholder={t("categoryPlaceholder")}
              options={categories.map((category) => ({ value: category.id, label: category.name }))}
              value={categoryId}
              onChange={setCategoryId}
            />
          </div>
        </div>

        {error && (
          <p className="font-body-md text-body-md text-error" role="alert">
            {error}
          </p>
        )}

        <Button onClick={handleCreate} disabled={isSaving || !title.trim()}>
          {t("createButton")}
        </Button>
      </div>
    </div>
  );
}
