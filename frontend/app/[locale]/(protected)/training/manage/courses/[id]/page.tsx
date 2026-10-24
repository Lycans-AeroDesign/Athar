"use client";

import { useTranslations } from "next-intl";
import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import {
  EMPTY_RESTRICTED_ACCESS_DRAFT,
  RestrictedAccessPicker,
  type RestrictedAccessDraft,
} from "@/components/knowledge/RestrictedAccessPicker";
import { CourseStatusPill } from "@/components/training/CourseStatusPill";
import { ImportCurriculumModal } from "@/components/training/ImportCurriculumModal";
import { Button } from "@/components/ui/Button";
import { Combobox } from "@/components/ui/Combobox";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Icon } from "@/components/ui/Icon";
import { IconButton } from "@/components/ui/IconButton";
import { Markdown } from "@/components/ui/Markdown";
import { MarkdownEditor } from "@/components/ui/MarkdownEditor";
import { Modal } from "@/components/ui/Modal";
import { PhotoDropzone } from "@/components/ui/PhotoDropzone";
import { EditorPageSkeleton } from "@/components/ui/Skeleton";
import { Switch } from "@/components/ui/Switch";
import { Link, useRouter } from "@/i18n/navigation";
import { uploadFile } from "@/lib/api/files";
import {
  addCourseAccessGrant,
  archiveCourse,
  createLesson,
  createModule,
  createResource,
  deleteCourse,
  deleteLesson,
  deleteModule,
  deleteResource,
  getCourse,
  getLesson,
  listCourseCategories,
  publishCourse,
  rejectCourse,
  removeCourseAccessGrant,
  reorderLessons,
  reorderModules,
  submitCourse,
  unarchiveCourse,
  updateCourse,
  updateLesson,
  updateModule,
  updateResource,
} from "@/lib/api/training";
import type {
  CourseCategory,
  CourseDetail,
  CourseDifficulty,
  CourseModule,
  CourseResourceProvider,
  LessonDetail,
  LessonType,
  Visibility,
} from "@/lib/api/types";
import { useAuth } from "@/lib/auth/AuthProvider";
import { useHasPermission } from "@/lib/auth/permissions";
import { errorMessage } from "@/lib/errors";
import { DIFFICULTY_ICONS, LESSON_TYPE_ICONS, VISIBILITY_ICONS } from "@/lib/optionIcons";

const DIFFICULTIES: CourseDifficulty[] = ["BEGINNER", "INTERMEDIATE", "ADVANCED"];
const VISIBILITY_VALUES: Visibility[] = ["PUBLIC", "RESTRICTED"];
const LESSON_TYPES: LessonType[] = ["TEXT", "VIDEO", "DOCUMENT", "EXTERNAL", "EXERCISE"];

function detectProvider(url: string): CourseResourceProvider {
  if (url.includes("youtube.com") || url.includes("youtu.be")) return "YOUTUBE";
  if (url.includes("drive.google.com")) return "GOOGLE_DRIVE";
  if (url.includes("vimeo.com")) return "VIMEO";
  if (url.includes("github.com")) return "GITHUB";
  return "WEBSITE";
}

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
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<"curriculum" | "settings">(
    searchParams.get("tab") === "settings" ? "settings" : "curriculum"
  );
  const [importModalOpen, setImportModalOpen] = useState(false);
  const justCreated = searchParams.get("created") === "true";

  // Course-info draft fields, synced from `course` on load/save (see the
  // effect below) - same "local draft, submit on Save" shape as ArticleEditor.
  const [title, setTitle] = useState("");
  const [shortDescription, setShortDescription] = useState("");
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [difficulty, setDifficulty] = useState<CourseDifficulty>("BEGINNER");
  const [visibility, setVisibility] = useState<Visibility>("PUBLIC");
  const [restrictedAccessDraft, setRestrictedAccessDraft] =
    useState<RestrictedAccessDraft>(EMPTY_RESTRICTED_ACCESS_DRAFT);
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

  const [editingLessonId, setEditingLessonId] = useState<string | null>(null);
  const [editingLesson, setEditingLesson] = useState<LessonDetail | null>(null);
  const [isEditingLessonLoading, setIsEditingLessonLoading] = useState(false);
  const [isSavingLesson, setIsSavingLesson] = useState(false);
  const [editLessonTitle, setEditLessonTitle] = useState("");
  const [editLessonType, setEditLessonType] = useState<LessonType>("TEXT");
  const [editLessonShortDesc, setEditLessonShortDesc] = useState("");
  const [editLessonContent, setEditLessonContent] = useState("");
  const [editLessonEstimatedMinutes, setEditLessonEstimatedMinutes] = useState(0);
  const [editLessonIsRequired, setEditLessonIsRequired] = useState(true);
  const [editLessonPrimaryUrl, setEditLessonPrimaryUrl] = useState("");
  const [editLessonError, setEditLessonError] = useState<string | null>(null);

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
    setVisibility(data.visibility);
    // The freshly-loaded restricted_to is the new source of truth - see
    // RestrictedAccessPicker's RestrictedAccessDraft docstring.
    setRestrictedAccessDraft(EMPTY_RESTRICTED_ACCESS_DRAFT);
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
    return <EditorPageSkeleton />;
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
    difficulty !== course.difficulty ||
    visibility !== course.visibility ||
    restrictedAccessDraft.pendingAdd.length > 0 ||
    restrictedAccessDraft.pendingRemoveGrantIds.length > 0;

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
        visibility,
      });
      for (const grantId of restrictedAccessDraft.pendingRemoveGrantIds) {
        await removeCourseAccessGrant(updated.id, grantId);
      }
      for (const grantUser of restrictedAccessDraft.pendingAdd) {
        await addCourseAccessGrant(updated.id, grantUser.id);
      }
      const hadGrantChanges =
        restrictedAccessDraft.pendingAdd.length > 0 || restrictedAccessDraft.pendingRemoveGrantIds.length > 0;
      // Re-fetch when grants changed so restricted_to reflects them.
      applyCourseToState(hadGrantChanges ? await getCourse(updated.id) : updated);
    } catch (err) {
      setError(errorMessage(err));
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
      setError(errorMessage(err));
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
      setError(errorMessage(err));
    }
  }

  async function handleDeleteCourse() {
    setError(null);
    try {
      await deleteCourse(course!.id);
      router.push("/training/manage");
    } catch (err) {
      setError(errorMessage(err));
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

  async function handleOpenEditLesson(lessonId: string) {
    setEditingLessonId(lessonId);
    setIsEditingLessonLoading(true);
    setEditLessonError(null);
    try {
      const data = await getLesson(lessonId);
      setEditingLesson(data);
      setEditLessonTitle(data.title);
      setEditLessonType(data.lesson_type);
      setEditLessonShortDesc(data.short_description || "");
      setEditLessonContent(data.content || "");
      setEditLessonEstimatedMinutes(data.estimated_minutes || 0);
      setEditLessonIsRequired(data.is_required);
      const primary = data.resources.find((r) => r.is_primary) ?? null;
      setEditLessonPrimaryUrl(primary?.resource_type === "EXTERNAL_LINK" ? primary.url : "");
    } catch (err) {
      setEditLessonError(errorMessage(err));
    } finally {
      setIsEditingLessonLoading(false);
    }
  }

  function handleCloseEditLesson() {
    setEditingLessonId(null);
    setEditingLesson(null);
    setEditLessonError(null);
  }

  async function handleSaveLessonEdit() {
    if (!editingLessonId || !editLessonTitle.trim()) return;
    setIsSavingLesson(true);
    setEditLessonError(null);
    try {
      await updateLesson(editingLessonId, {
        title: editLessonTitle.trim(),
        lesson_type: editLessonType,
        short_description: editLessonShortDesc.trim(),
        content: editLessonContent.trim(),
        estimated_minutes: editLessonEstimatedMinutes,
        is_required: editLessonIsRequired,
      });

      const trimmedUrl = editLessonPrimaryUrl.trim();
      const primary = editingLesson?.resources.find((r) => r.is_primary) ?? null;

      if (trimmedUrl) {
        const provider = detectProvider(trimmedUrl);
        const resourcePayload = {
          title: editLessonTitle.trim() || lessonTypeT(editLessonType),
          resource_type: "EXTERNAL_LINK" as const,
          provider,
          url: trimmedUrl,
          stored_file_id: null,
          is_primary: true,
        };
        if (primary && primary.resource_type === "EXTERNAL_LINK") {
          await updateResource(primary.id, resourcePayload);
        } else {
          await createResource(editingLessonId, resourcePayload);
        }
      } else if (primary) {
        await deleteResource(primary.id);
      }

      await loadCourse();
      handleCloseEditLesson();
    } catch (err) {
      setEditLessonError(errorMessage(err));
    } finally {
      setIsSavingLesson(false);
    }
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

      <div className="flex items-center gap-2 border-b border-outline-variant">
        <button
          type="button"
          onClick={() => setActiveTab("curriculum")}
          className={`flex items-center gap-2 px-4 py-2.5 font-label-caps text-label-caps uppercase border-b-2 transition-colors ${
            activeTab === "curriculum"
              ? "border-primary text-primary font-bold"
              : "border-transparent text-on-surface-variant hover:text-on-surface"
          }`}
        >
          <Icon name="list" size={16} />
          {t("curriculumTab")}
          <span className="ms-1 px-1.5 py-0.5 rounded-full bg-surface-variant text-[11px] font-mono">
            {course.modules.length}
          </span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("settings")}
          className={`flex items-center gap-2 px-4 py-2.5 font-label-caps text-label-caps uppercase border-b-2 transition-colors ${
            activeTab === "settings"
              ? "border-primary text-primary font-bold"
              : "border-transparent text-on-surface-variant hover:text-on-surface"
          }`}
        >
          <Icon name="settings" size={16} />
          {t("settingsTab")}
          {isDirty && (
            <span className="h-2 w-2 rounded-full bg-primary" />
          )}
        </button>
      </div>

      {activeTab === "settings" && (
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
              options={DIFFICULTIES.map((value) => ({ value, label: difficultyT(value), ...DIFFICULTY_ICONS[value] }))}
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
          <div className="w-full sm:w-56">
            <Combobox
              label={t("visibilityLabel")}
              options={VISIBILITY_VALUES.map((value) => ({ value, label: t(`visibility${value}`), ...VISIBILITY_ICONS[value] }))}
              value={visibility}
              onChange={(value) => setVisibility(value as Visibility)}
            />
          </div>
        </div>

        {visibility === "RESTRICTED" && (
          <RestrictedAccessPicker
            initialGrants={course.restricted_to}
            value={restrictedAccessDraft}
            onChange={setRestrictedAccessDraft}
          />
        )}

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
      )}

      {activeTab === "curriculum" && (
        <div className="space-y-4">
          {justCreated && course.modules.length === 0 && (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-xl bg-primary-container/30 border border-primary/30 text-on-surface">
              <div className="flex items-center gap-2.5">
                <Icon name="check_circle" size={20} className="text-primary shrink-0" />
                <span className="font-body-md text-body-md">{t("courseCreatedNotice")}</span>
              </div>
              {canEdit && (
                <Button size="sm" onClick={() => setImportModalOpen(true)} className="shrink-0">
                  <Icon name="upload" size={16} />
                  {t("importOutlineButton")}
                </Button>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-headline-md text-headline-md text-on-surface">{t("modulesTitle")}</h2>
            {canEdit && (
              <Button variant="secondary" onClick={() => setImportModalOpen(true)}>
                <Icon name="upload" size={16} />
                {t("importOutlineButton")}
              </Button>
            )}
          </div>
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
                      <IconButton icon="edit" size={16} aria-label={t("editLessonButton")} onClick={() => handleOpenEditLesson(lesson.id)} />
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
                      options={LESSON_TYPES.map((value) => ({ value, label: lessonTypeT(value), ...LESSON_TYPE_ICONS[value] }))}
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
      )}

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

      <Modal
        open={editingLessonId !== null}
        onOpenChange={(open) => !open && handleCloseEditLesson()}
        title={`${commonT("edit")}: ${editLessonTitle || editingLesson?.title || ""}`}
        wide
        footer={
          <div className="flex items-center justify-between w-full">
            <Link
              href={`/training/manage/courses/${course.id}/lessons/${editingLessonId}`}
              className="text-xs text-primary hover:underline flex items-center gap-1"
            >
              <Icon name="open_in_new" size={14} />
              Full Lesson Editor
            </Link>
            <div className="flex items-center gap-2">
              <Button variant="secondary" onClick={handleCloseEditLesson} disabled={isSavingLesson}>
                {commonT("cancel")}
              </Button>
              <Button onClick={handleSaveLessonEdit} disabled={isSavingLesson || !editLessonTitle.trim()}>
                {isSavingLesson ? "Saving..." : commonT("save")}
              </Button>
            </div>
          </div>
        }
      >
        {isEditingLessonLoading ? (
          <div className="py-12 flex justify-center">
            <Icon name="pending" className="animate-spin text-primary" size={32} />
          </div>
        ) : (
          <div className="space-y-4">
            {editLessonError && (
              <div className="p-3 text-sm rounded-lg bg-error-container text-on-error-container">
                {editLessonError}
              </div>
            )}
            <div>
              <label className="block font-label-caps text-label-caps text-on-surface-variant uppercase mb-1">
                {commonT("title")}
              </label>
              <input
                type="text"
                className="block w-full px-4 py-2 font-body-md text-body-md text-on-surface bg-surface border border-outline-variant rounded-lg focus:ring-1 focus:ring-primary focus:border-primary outline-none"
                value={editLessonTitle}
                onChange={(e) => setEditLessonTitle(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block font-label-caps text-label-caps text-on-surface-variant uppercase mb-1">
                  Type
                </label>
                <Combobox
                  value={editLessonType}
                  onChange={(v) => setEditLessonType(v as LessonType)}
                  options={LESSON_TYPES.map((type) => ({
                    value: type,
                    label: lessonTypeT(type),
                    ...LESSON_TYPE_ICONS[type],
                  }))}
                />
              </div>
              <div>
                <label className="block font-label-caps text-label-caps text-on-surface-variant uppercase mb-1">
                  {t("estimatedMinutesLabel")}
                </label>
                <input
                  type="number"
                  min={0}
                  className="block w-full px-4 py-2 font-body-md text-body-md text-on-surface bg-surface border border-outline-variant rounded-lg focus:ring-1 focus:ring-primary focus:border-primary outline-none"
                  value={editLessonEstimatedMinutes}
                  onChange={(e) => setEditLessonEstimatedMinutes(Number(e.target.value) || 0)}
                />
              </div>
            </div>

            {(editLessonType === "VIDEO" || editLessonType === "DOCUMENT" || editLessonType === "EXTERNAL") && (
              <div>
                <label className="block font-label-caps text-label-caps text-on-surface-variant uppercase mb-1">
                  {editLessonType === "VIDEO" ? "Video URL (SharePoint, YouTube, etc.)" : "Resource URL"}
                </label>
                <input
                  type="url"
                  placeholder="https://alexuuni-my.sharepoint.com/... or https://youtu.be/..."
                  className="block w-full px-4 py-2 font-body-md text-body-md text-on-surface bg-surface border border-outline-variant rounded-lg focus:ring-1 focus:ring-primary focus:border-primary outline-none"
                  value={editLessonPrimaryUrl}
                  onChange={(e) => setEditLessonPrimaryUrl(e.target.value)}
                />
                <p className="mt-1 text-xs text-on-surface-variant">
                  {editLessonType === "VIDEO"
                    ? "Direct SharePoint video link or YouTube embed link set as main lesson content."
                    : "Direct link set as the main lesson content."}
                </p>
              </div>
            )}

            <div>
              <label className="block font-label-caps text-label-caps text-on-surface-variant uppercase mb-1">
                Short Description
              </label>
              <textarea
                rows={2}
                maxLength={290}
                placeholder="Brief summary (optional)"
                className="block w-full px-4 py-2 font-body-md text-body-md text-on-surface bg-surface border border-outline-variant rounded-lg focus:ring-1 focus:ring-primary focus:border-primary outline-none"
                value={editLessonShortDesc}
                onChange={(e) => setEditLessonShortDesc(e.target.value)}
              />
              <div className="flex justify-end text-xs text-on-surface-variant mt-0.5">
                {editLessonShortDesc.length} / 290
              </div>
            </div>

            <div>
              <label className="block font-label-caps text-label-caps text-on-surface-variant uppercase mb-1">
                Content / Notes (Markdown)
              </label>
              <textarea
                rows={4}
                placeholder="Detailed notes or lesson text..."
                className="block w-full px-4 py-2 font-body-md text-body-md text-on-surface bg-surface border border-outline-variant rounded-lg focus:ring-1 focus:ring-primary focus:border-primary outline-none font-mono text-sm"
                value={editLessonContent}
                onChange={(e) => setEditLessonContent(e.target.value)}
              />
            </div>

            <div className="pt-2">
              <Switch
                checked={editLessonIsRequired}
                onChange={setEditLessonIsRequired}
                label={t("requiredLabel")}
              />
            </div>
          </div>
        )}
      </Modal>

      {canEdit && (
        <ImportCurriculumModal
          courseId={course.id}
          open={importModalOpen}
          onOpenChange={setImportModalOpen}
          onSuccess={applyCourseToState}
        />
      )}
    </div>
  );
}
