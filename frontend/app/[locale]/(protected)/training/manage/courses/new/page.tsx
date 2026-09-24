"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import {
  EMPTY_RESTRICTED_ACCESS_DRAFT,
  RestrictedAccessPicker,
  type RestrictedAccessDraft,
} from "@/components/knowledge/RestrictedAccessPicker";
import { Button } from "@/components/ui/Button";
import { Combobox } from "@/components/ui/Combobox";
import { Icon } from "@/components/ui/Icon";
import { MarkdownEditor } from "@/components/ui/MarkdownEditor";
import { PhotoDropzone } from "@/components/ui/PhotoDropzone";
import { Link, useRouter } from "@/i18n/navigation";
import { uploadFile } from "@/lib/api/files";
import { addCourseAccessGrant, createCourse, listCourseCategories } from "@/lib/api/training";
import type { CourseCategory, CourseDifficulty, StoredFileRef, Visibility } from "@/lib/api/types";

const DIFFICULTIES: CourseDifficulty[] = ["BEGINNER", "INTERMEDIATE", "ADVANCED"];
const VISIBILITY_VALUES: Visibility[] = ["PUBLIC", "RESTRICTED"];

export default function NewCoursePage() {
  const t = useTranslations("training.manage");
  const commonT = useTranslations("common");
  const difficultyT = useTranslations("training.difficulty");
  const router = useRouter();

  const [categories, setCategories] = useState<CourseCategory[]>([]);
  const [title, setTitle] = useState("");
  const [shortDescription, setShortDescription] = useState("");
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [difficulty, setDifficulty] = useState<CourseDifficulty>("BEGINNER");
  const [visibility, setVisibility] = useState<Visibility>("PUBLIC");
  const [restrictedAccessDraft, setRestrictedAccessDraft] =
    useState<RestrictedAccessDraft>(EMPTY_RESTRICTED_ACCESS_DRAFT);
  const [coverImage, setCoverImage] = useState<StoredFileRef | null>(null);
  const [coverUploadProgress, setCoverUploadProgress] = useState<number | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listCourseCategories().then(setCategories);
  }, []);

  async function handleCoverUpload(file: File) {
    setCoverUploadProgress(0);
    setError(null);
    try {
      setCoverImage(await uploadFile(file, { onProgress: setCoverUploadProgress }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCoverUploadProgress(null);
    }
  }

  async function handleCreate() {
    setIsSaving(true);
    setError(null);
    try {
      const course = await createCourse({
        title,
        short_description: shortDescription,
        description,
        category_id: categoryId,
        cover_image_id: coverImage?.id ?? null,
        difficulty,
        visibility,
      });
      // A brand-new course has no saved grants yet, so only additions apply.
      if (visibility === "RESTRICTED") {
        for (const user of restrictedAccessDraft.pendingAdd) {
          await addCourseAccessGrant(course.id, user.id);
        }
      }
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

      <div className="space-y-4 bg-surface-container-low border border-outline-variant rounded-xl p-4 sm:p-6">
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
        <MarkdownEditor value={description} onChange={setDescription} placeholder={t("descriptionPlaceholder")} />
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
          <div className="w-56">
            <Combobox
              label={t("visibilityLabel")}
              options={VISIBILITY_VALUES.map((value) => ({ value, label: t(`visibility${value}`) }))}
              value={visibility}
              onChange={(value) => setVisibility(value as Visibility)}
            />
          </div>
        </div>

        {visibility === "RESTRICTED" && (
          <RestrictedAccessPicker
            initialGrants={[]}
            value={restrictedAccessDraft}
            onChange={setRestrictedAccessDraft}
          />
        )}

        {/* Its own block row (not a bare inline-flex Button sibling) so it
            never ends up sharing a line with the Create button below - same
            layout precedent as the course edit page's own PhotoDropzone. */}
        <PhotoDropzone
          value={coverImage}
          onFileSelected={handleCoverUpload}
          onUnsupportedFile={() => setError(commonT("unsupportedImageType"))}
          progress={coverUploadProgress}
          alt={coverImage ? t("changeCoverButton") : t("addCoverButton")}
          shape="wide"
          className="h-36 w-full sm:w-72"
        />

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
