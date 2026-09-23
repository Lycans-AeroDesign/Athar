"use client";

import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { CourseStatusPill } from "@/components/training/CourseStatusPill";
import { Button } from "@/components/ui/Button";
import { Combobox } from "@/components/ui/Combobox";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Icon } from "@/components/ui/Icon";
import { IconButton } from "@/components/ui/IconButton";
import { Markdown } from "@/components/ui/Markdown";
import { MarkdownEditor } from "@/components/ui/MarkdownEditor";
import { Modal } from "@/components/ui/Modal";
import { PhotoDropzone } from "@/components/ui/PhotoDropzone";
import { Link, useRouter } from "@/i18n/navigation";
import { uploadFile } from "@/lib/api/files";
import {
  archiveCourse,
  createLesson,
  createModule,
  deleteCourse,
  deleteLesson,
  deleteModule,
  getCourse,
  listCourseCategories,
  publishCourse,
  rejectCourse,
  reorderLessons,
  reorderModules,
  submitCourse,
  unarchiveCourse,
  updateCourse,
  updateModule,
} from "@/lib/api/training";
import type { CourseCategory, CourseDetail, CourseDifficulty, CourseModule, LessonType } from "@/lib/api/types";
import { useAuth } from "@/lib/auth/AuthProvider";
import { useHasPermission } from "@/lib/auth/permissions";

const DIFFICULTIES: CourseDifficulty[] = ["BEGINNER", "INTERMEDIATE", "ADVANCED"];
const LESSON_TYPES: LessonType[] = ["TEXT", "VIDEO", "DOCUMENT", "EXTERNAL", "EXERCISE"];

export default function CourseEditorPage() {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations("training.manage");
  const commonT = useTranslations("common");
  const workflowT = useTranslations("training.workflow");
  const difficultyT = useTranslations("training.difficulty");
  const lessonTypeT = useTranslations("training.lessonType");
  const { user } = useAuth();
  const router = useRouter();

  const canUpdateAny = useHasPermission("training.update");
  const canDeleteAny = useHasPermission("training.delete");
  const canPublish = useHasPermission("training.publish");
  const canReview = useHasPermission("training.review");
  const canArchive = useHasPermission("training.archive");

  const [course, setCourse] = useState<CourseDetail | null>(null);
  const [categories, setCategories] = useState<CourseCategory[]>([]);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Course-info draft fields, synced from `course` on load/save (see the
  // effect below) - same "local draft, submit on Save" shape as ArticleEditor.
  const [title, setTitle] = useState("");
  const [shortDescription, setShortDescription] = useState("");
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [difficulty, setDifficulty] = useState<CourseDifficulty>("BEGINNER");
  const [coverUploadProgress, setCoverUploadProgress] = useState<number | null>(null);

  const [newModuleTitle, setNewModuleTitle] = useState("");
  const [editingModuleId, setEditingModuleId] = useState<string | null>(null);
  const [editModuleTitle, setEditModuleTitle] = useState("");
  const [editModuleDescription, setEditModuleDescription] = useState("");
  const [editModuleEstimatedMinutes, setEditModuleEstimatedMinutes] = useState(0);
  const [addingLessonToModuleId, setAddingLessonToModuleId] = useState<string | null>(null);
  const [newLessonTitle, setNewLessonTitle] = useState("");
  const [newLessonType, setNewLessonType] = useState<LessonType>("TEXT");
  const [deleteModuleId, setDeleteModuleId] = useState<string | null>(null);
  const [deleteLessonId, setDeleteLessonId] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  // Always resyncs every local draft field from the server's response, not
  // just `course` itself - DRF's CharField trims whitespace server-side by
  // default, so a title/description saved with a stray trailing space would
  // otherwise leave the local draft permanently mismatched against the saved
  // `course.title` (isDirty comparing them would never go false again, even
  // though the save genuinely succeeded - the Save button would stay
  // enabled forever). Used after both the initial load and every save.
  function applyCourseToState(data: CourseDetail) {
    setCourse(data);
    setTitle(data.title);
    setShortDescription(data.short_description);
    setDescription(data.description);
    setCategoryId(data.category?.id ?? null);
    setDifficulty(data.difficulty);
  }

  function loadCourse() {
    return getCourse(id).then((data) => {
      applyCourseToState(data);
      return data;
    }, () => setNotFound(true));
  }

  useEffect(() => {
    loadCourse();
    listCourseCategories().then(setCategories);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (notFound) {
    return <p className="font-body-md text-body-md text-error">Not found.</p>;
  }
  if (!course) {
    return <p className="font-body-md text-body-md text-on-surface-variant">{t("loading")}</p>;
  }

  const isAuthor = user?.id === course.author?.id;
  const canEdit = isAuthor || canUpdateAny;
  const canDelete = (isAuthor && course.status === "DRAFT") || canDeleteAny;
  const canSubmit = isAuthor && (course.status === "DRAFT" || course.status === "REJECTED");
  const canPublishNow = canPublish && (course.status === "DRAFT" || course.status === "IN_REVIEW");
  const canRejectNow = canReview && course.status === "IN_REVIEW";
  const canArchiveNow = canArchive && course.status === "PUBLISHED";
  const canUnarchiveNow = canArchive && course.status === "ARCHIVED";

  const isDirty =
    title !== course.title ||
    shortDescription !== course.short_description ||
    description !== course.description ||
    categoryId !== (course.category?.id ?? null) ||
    difficulty !== course.difficulty;

  async function handleSaveInfo() {
    setIsSaving(true);
    setError(null);
    try {
      const updated = await updateCourse(course!.id, {
        title,
        short_description: shortDescription,
        description,
        category_id: categoryId,
        difficulty,
      });
      applyCourseToState(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleCoverUpload(file: File) {
    setCoverUploadProgress(0);
    setError(null);
    try {
      const uploaded = await uploadFile(file, { onProgress: setCoverUploadProgress });
      setCourse(await updateCourse(course!.id, { cover_image_id: uploaded.id }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCoverUploadProgress(null);
    }
  }

  async function runAction<T>(action: () => Promise<T>) {
    setError(null);
    try {
      await action();
      await loadCourse();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleDeleteCourse() {
    setError(null);
    try {
      await deleteCourse(course!.id);
      router.push("/training/manage");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleAddModule() {
    if (!newModuleTitle.trim()) return;
    await runAction(() => createModule(course!.id, { title: newModuleTitle.trim() }));
    setNewModuleTitle("");
  }

  async function handleMoveModule(moduleId: string, direction: -1 | 1) {
    const order = course!.modules.map((module) => module.id);
    const index = order.indexOf(moduleId);
    const swapWith = index + direction;
    if (swapWith < 0 || swapWith >= order.length) return;
    [order[index], order[swapWith]] = [order[swapWith], order[index]];
    await runAction(() => reorderModules(course!.id, order));
  }

  async function handleDeleteModule() {
    if (!deleteModuleId) return;
    await runAction(() => deleteModule(deleteModuleId));
    setDeleteModuleId(null);
  }

  function startEditModule(module: CourseModule) {
    setEditingModuleId(module.id);
    setEditModuleTitle(module.title);
    setEditModuleDescription(module.description);
    setEditModuleEstimatedMinutes(module.estimated_minutes);
  }

  function cancelEditModule() {
    setEditingModuleId(null);
  }

  async function handleSaveModuleEdit(moduleId: string) {
    if (!editModuleTitle.trim()) return;
    await runAction(() =>
      updateModule(moduleId, {
        title: editModuleTitle.trim(),
        description: editModuleDescription,
        estimated_minutes: editModuleEstimatedMinutes,
      }),
    );
    setEditingModuleId(null);
  }

  async function handleAddLesson(moduleId: string) {
    if (!newLessonTitle.trim()) return;
    await runAction(() => createLesson(moduleId, { title: newLessonTitle.trim(), lesson_type: newLessonType }));
    setNewLessonTitle("");
    setNewLessonType("TEXT");
    setAddingLessonToModuleId(null);
  }

  async function handleMoveLesson(moduleId: string, lessonId: string, direction: -1 | 1) {
    const courseModule = course!.modules.find((m) => m.id === moduleId)!;
    const order = courseModule.lessons.map((lesson) => lesson.id);
    const index = order.indexOf(lessonId);
    const swapWith = index + direction;
    if (swapWith < 0 || swapWith >= order.length) return;
    [order[index], order[swapWith]] = [order[swapWith], order[index]];
    await runAction(() => reorderLessons(moduleId, order));
  }

  async function handleDeleteLesson() {
    if (!deleteLessonId) return;
    await runAction(() => deleteLesson(deleteLessonId));
    setDeleteLessonId(null);
  }

  return (
    <div className="max-w-[800px] mx-auto space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/training/manage"
          className="inline-flex items-center gap-1 font-label-caps text-label-caps uppercase text-on-surface-variant hover:text-on-surface transition-colors"
        >
          <Icon name="arrow_back" size={16} />
          {t("backToManage")}
        </Link>
        <div className="flex items-center gap-2">
          <CourseStatusPill status={course.status} />
          <Link href={`/training/courses/${course.id}`}>
            <IconButton icon="visibility" variant="secondary" aria-label={t("previewButton")} />
          </Link>
          {canDelete && (
            <IconButton icon="delete" variant="danger" aria-label={workflowT("deleteButton")} onClick={() => setDeleteOpen(true)} />
          )}
        </div>
      </div>

      {error && (
        <p className="font-body-md text-body-md text-error" role="alert">
          {error}
        </p>
      )}

      {(canSubmit || canPublishNow || canRejectNow || canArchiveNow || canUnarchiveNow) && (
        <div className="flex flex-wrap items-center gap-3 pb-4 border-b border-outline-variant">
          {canSubmit && <Button onClick={() => runAction(() => submitCourse(course!.id))}>{workflowT("submitForReview")}</Button>}
          {canPublishNow && <Button onClick={() => runAction(() => publishCourse(course!.id))}>{workflowT("publish")}</Button>}
          {canRejectNow && (
            <Button variant="secondary" onClick={() => setRejectOpen(true)}>
              {workflowT("rejectButton")}
            </Button>
          )}
          {canArchiveNow && (
            <Button variant="secondary" onClick={() => setArchiveOpen(true)}>
              {workflowT("archiveButton")}
            </Button>
          )}
          {canUnarchiveNow && <Button onClick={() => runAction(() => unarchiveCourse(course!.id))}>{workflowT("unarchiveButton")}</Button>}
        </div>
      )}

      <div className="space-y-4 bg-surface-container-low border border-outline-variant rounded-xl p-4 sm:p-6">
        <h2 className="font-headline-md text-headline-md text-on-surface">{t("courseEditorTitle")}</h2>
        <input
          className="w-full font-headline-lg text-headline-lg font-bold border-none bg-transparent placeholder:text-on-surface-variant/50 focus:ring-0 p-0 text-on-surface outline-none"
          placeholder={t("titlePlaceholder")}
          value={title}
          disabled={!canEdit}
          onChange={(e) => setTitle(e.target.value)}
        />
        <input
          className="w-full bg-transparent border-none font-body-md text-body-md text-on-surface-variant placeholder:text-on-surface-variant/50 focus:ring-0 p-0 outline-none"
          placeholder={t("shortDescriptionPlaceholder")}
          value={shortDescription}
          disabled={!canEdit}
          onChange={(e) => setShortDescription(e.target.value)}
        />
        {canEdit ? (
          <MarkdownEditor value={description} onChange={setDescription} placeholder={t("descriptionPlaceholder")} />
        ) : (
          description && <Markdown content={description} />
        )}
        <div className="flex flex-wrap gap-3">
          <div className="w-full sm:w-56">
            <Combobox
              label={t("difficultyLabel")}
              options={DIFFICULTIES.map((value) => ({ value, label: difficultyT(value) }))}
              value={difficulty}
              onChange={(value) => setDifficulty(value as CourseDifficulty)}
            />
          </div>
          <div className="w-full sm:w-56">
            <Combobox
              label={t("categoryLabel")}
              placeholder={t("categoryPlaceholder")}
              options={categories.map((category) => ({ value: category.id, label: category.name }))}
              value={categoryId}
              onChange={setCategoryId}
            />
          </div>
        </div>

        {/* Its own block row (not a bare inline-flex Button sibling) so it
            never ends up sharing a line with the Save button below. */}
        <PhotoDropzone
          value={course.cover_image}
          onFileSelected={handleCoverUpload}
          onUnsupportedFile={() => setError(commonT("unsupportedImageType"))}
          progress={coverUploadProgress}
          alt={course.cover_image ? t("changeCoverButton") : t("addCoverButton")}
          shape="wide"
          className="h-36 w-full sm:w-72"
        />

        {canEdit && (
          <div className="pt-2 border-t border-outline-variant">
            <Button onClick={handleSaveInfo} disabled={isSaving || !isDirty || !title.trim()}>
              {t("saveButton")}
            </Button>
          </div>
        )}
      </div>

      <div className="space-y-4">
        <h2 className="font-headline-md text-headline-md text-on-surface">{t("modulesTitle")}</h2>
        {course.modules.map((module, moduleIndex) =>
          editingModuleId === module.id ? (
            <div key={module.id} className="bg-surface-container-low border border-primary rounded-xl p-4 space-y-3">
              <input
                className="w-full font-headline-md text-headline-md font-bold bg-transparent border-none focus:ring-0 p-0 text-on-surface outline-none"
                value={editModuleTitle}
                onChange={(e) => setEditModuleTitle(e.target.value)}
              />
              <textarea
                className="block w-full min-h-[80px] px-4 py-2 font-body-md text-body-md text-on-surface bg-surface border border-outline-variant rounded-lg focus:ring-1 focus:ring-primary focus:border-primary outline-none transition-colors"
                placeholder={t("moduleDescriptionPlaceholder")}
                value={editModuleDescription}
                onChange={(e) => setEditModuleDescription(e.target.value)}
              />
              <div className="w-40">
                <label className="block font-label-caps text-label-caps text-on-surface-variant uppercase mb-2">
                  {t("estimatedMinutesLabel")}
                </label>
                <input
                  type="number"
                  min={0}
                  className="block w-full px-4 py-2 font-body-md text-body-md text-on-surface bg-surface border border-outline-variant rounded-lg focus:ring-1 focus:ring-primary focus:border-primary outline-none transition-colors"
                  value={editModuleEstimatedMinutes}
                  onChange={(e) => setEditModuleEstimatedMinutes(Number(e.target.value) || 0)}
                />
              </div>
              <div className="flex items-center gap-2">
                <Button variant="secondary" onClick={cancelEditModule}>
                  {commonT("cancel")}
                </Button>
                <Button onClick={() => handleSaveModuleEdit(module.id)} disabled={!editModuleTitle.trim()}>
                  {commonT("save")}
                </Button>
              </div>
            </div>
          ) : (
          <div key={module.id} className="bg-surface-container-low border border-outline-variant rounded-xl p-4 space-y-3">
            {/* Title above the icon buttons below sm - side by side, four buttons leave the title almost no room. */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div className="flex-1 min-w-0">
                <h3 className="font-headline-md text-headline-md font-bold text-on-surface truncate">{module.title}</h3>
                {module.description && (
                  <p className="font-body-md text-body-md text-on-surface-variant">{module.description}</p>
                )}
                {module.estimated_minutes > 0 && (
                  <span className="font-label-caps text-label-caps text-on-surface-variant">
                    {t("estimatedMinutesLabel")}: {module.estimated_minutes}
                  </span>
                )}
              </div>
              {canEdit && (
                <div className="flex items-center gap-1 shrink-0 self-end sm:self-auto">
                  <IconButton icon="edit" aria-label={t("editModuleButton")} onClick={() => startEditModule(module)} />
                  <IconButton icon="arrow_upward" aria-label={t("moveUp")} disabled={moduleIndex === 0} onClick={() => handleMoveModule(module.id, -1)} />
                  <IconButton icon="arrow_downward" aria-label={t("moveDown")} disabled={moduleIndex === course.modules.length - 1} onClick={() => handleMoveModule(module.id, 1)} />
                  <IconButton icon="delete" variant="danger" aria-label={t("deleteModuleButton")} onClick={() => setDeleteModuleId(module.id)} />
                </div>
              )}
            </div>

            <ul className="space-y-1">
              {module.lessons.map((lesson, lessonIndex) => (
                <li key={lesson.id} className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-surface">
                  <Link
                    href={`/training/manage/courses/${course.id}/lessons/${lesson.id}`}
                    className="flex-1 min-w-0 flex flex-wrap items-center gap-x-2 font-body-md text-body-md text-on-surface hover:text-primary transition-colors"
                  >
                    <span className="truncate max-w-full">{lesson.title}</span>
                    <span className="font-label-caps text-label-caps text-on-surface-variant uppercase shrink-0">
                      {lessonTypeT(lesson.lesson_type)}
                    </span>
                    {!lesson.is_required && (
                      <span className="font-label-caps text-label-caps text-on-surface-variant shrink-0">{t("optionalLabel")}</span>
                    )}
                  </Link>
                  {canEdit && (
                    <div className="flex items-center gap-1 shrink-0">
                      <IconButton icon="arrow_upward" size={16} aria-label={t("moveUp")} disabled={lessonIndex === 0} onClick={() => handleMoveLesson(module.id, lesson.id, -1)} />
                      <IconButton icon="arrow_downward" size={16} aria-label={t("moveDown")} disabled={lessonIndex === module.lessons.length - 1} onClick={() => handleMoveLesson(module.id, lesson.id, 1)} />
                      <IconButton icon="delete" size={16} variant="danger" aria-label={t("deleteLessonButton")} onClick={() => setDeleteLessonId(lesson.id)} />
                    </div>
                  )}
                </li>
              ))}
              {module.lessons.length === 0 && (
                <li className="font-body-md text-body-md text-on-surface-variant px-3 py-2">{t("noLessons")}</li>
              )}
            </ul>

            {canEdit &&
              (addingLessonToModuleId === module.id ? (
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    autoFocus
                    className="flex-1 min-w-[160px] px-3 py-2 font-body-md text-body-md text-on-surface bg-surface border border-outline-variant rounded-lg focus:ring-1 focus:ring-primary focus:border-primary outline-none transition-colors"
                    placeholder={t("lessonTitlePlaceholder")}
                    value={newLessonTitle}
                    onChange={(e) => setNewLessonTitle(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleAddLesson(module.id)}
                  />
                  <div className="w-40">
                    <Combobox
                      options={LESSON_TYPES.map((value) => ({ value, label: lessonTypeT(value) }))}
                      value={newLessonType}
                      onChange={(value) => setNewLessonType(value as LessonType)}
                    />
                  </div>
                  <Button variant="secondary" onClick={() => handleAddLesson(module.id)} disabled={!newLessonTitle.trim()}>
                    {t("addLessonButton")}
                  </Button>
                </div>
              ) : (
                <Button variant="ghost" onClick={() => setAddingLessonToModuleId(module.id)}>
                  <Icon name="add" size={16} />
                  {t("addLessonButton")}
                </Button>
              ))}
          </div>
          ),
        )}

        {canEdit && (
          <div className="flex items-center gap-2 max-w-md">
            <input
              className="flex-1 px-4 py-2 font-body-md text-body-md text-on-surface bg-surface border border-outline-variant rounded-lg focus:ring-1 focus:ring-primary focus:border-primary outline-none transition-colors"
              placeholder={t("moduleTitlePlaceholder")}
              value={newModuleTitle}
              onChange={(e) => setNewModuleTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAddModule()}
            />
            <Button onClick={handleAddModule} disabled={!newModuleTitle.trim()}>
              <Icon name="add" size={18} />
              {t("addModuleButton")}
            </Button>
          </div>
        )}
      </div>

      <ConfirmModal
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={workflowT("deleteConfirmTitle")}
        description={workflowT("deleteConfirmBody")}
        confirmLabel={workflowT("deleteButton")}
        danger
        onConfirm={handleDeleteCourse}
      />
      <ConfirmModal
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        title={workflowT("archiveConfirmTitle")}
        description={workflowT("archiveConfirmBody")}
        confirmLabel={workflowT("archiveButton")}
        onConfirm={() => runAction(() => archiveCourse(course!.id))}
      />
      <Modal
        open={rejectOpen}
        onOpenChange={setRejectOpen}
        title={workflowT("rejectModalTitle")}
        isDirty={rejectReason.length > 0}
        footer={
          <Button variant="danger" onClick={() => runAction(() => rejectCourse(course!.id, rejectReason.trim())).then(() => setRejectReason(""))}>
            {workflowT("rejectButton")}
          </Button>
        }
      >
        <div className="space-y-2">
          <label className="block font-label-caps text-label-caps text-on-surface-variant uppercase">{workflowT("rejectReasonLabel")}</label>
          <textarea
            className="block w-full min-h-[100px] px-4 py-2 font-body-md text-body-md text-on-surface bg-surface-container border border-outline-variant rounded-lg focus:ring-1 focus:ring-primary focus:border-primary outline-none transition-colors"
            placeholder={workflowT("rejectReasonPlaceholder")}
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
          />
        </div>
      </Modal>
      <ConfirmModal
        open={deleteModuleId !== null}
        onOpenChange={(open) => !open && setDeleteModuleId(null)}
        title={t("deleteModuleConfirmTitle")}
        description={t("deleteModuleConfirmBody")}
        danger
        onConfirm={handleDeleteModule}
      />
      <ConfirmModal
        open={deleteLessonId !== null}
        onOpenChange={(open) => !open && setDeleteLessonId(null)}
        title={t("deleteLessonConfirmTitle")}
        description={t("deleteLessonConfirmBody")}
        danger
        onConfirm={handleDeleteLesson}
      />
    </div>
  );
}
