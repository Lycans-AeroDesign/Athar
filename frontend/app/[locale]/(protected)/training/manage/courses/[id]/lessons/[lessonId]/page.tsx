"use client";

import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { RelatedKnowledgePanel } from "@/components/training/RelatedKnowledgePanel";
import { Button } from "@/components/ui/Button";
import { Combobox } from "@/components/ui/Combobox";
import { FileDropzone } from "@/components/ui/FileDropzone";
import { Icon } from "@/components/ui/Icon";
import { IconButton } from "@/components/ui/IconButton";
import { MarkdownEditor } from "@/components/ui/MarkdownEditor";
import { Link } from "@/i18n/navigation";
import { uploadFile } from "@/lib/api/files";
import {
  createObjective,
  createResource,
  deleteObjective,
  deleteResource,
  getLesson,
  reorderObjectives,
  reorderResources,
  updateLesson,
  updateObjective,
  updateResource,
} from "@/lib/api/training";
import type { CourseResource, CourseResourceProvider, LessonDetail, LessonType } from "@/lib/api/types";
import { LESSON_TYPE_ICONS, RESOURCE_PROVIDER_ICONS } from "@/lib/optionIcons";

const LESSON_TYPES: LessonType[] = ["TEXT", "VIDEO", "DOCUMENT", "EXTERNAL", "EXERCISE"];
const PROVIDERS: CourseResourceProvider[] = ["GOOGLE_DRIVE", "YOUTUBE", "VIMEO", "GITHUB", "WEBSITE", "OTHER"];

export default function LessonEditorPage() {
  const { id, lessonId } = useParams<{ id: string; lessonId: string }>();
  const t = useTranslations("training.lessonEditor");
  const resourceT = useTranslations("training.resourceEditor");
  const lessonTypeT = useTranslations("training.lessonType");
  const commonT = useTranslations("common");

  const [lesson, setLesson] = useState<LessonDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const [title, setTitle] = useState("");
  const [shortDescription, setShortDescription] = useState("");
  const [lessonType, setLessonType] = useState<LessonType>("TEXT");
  const [content, setContent] = useState("");
  const [estimatedMinutes, setEstimatedMinutes] = useState(0);
  const [isRequired, setIsRequired] = useState(true);

  const [newObjectiveText, setNewObjectiveText] = useState("");
  const [editingObjectiveId, setEditingObjectiveId] = useState<string | null>(null);
  const [editObjectiveText, setEditObjectiveText] = useState("");

  const [newResourceTitle, setNewResourceTitle] = useState("");
  const [newResourceProvider, setNewResourceProvider] = useState<CourseResourceProvider>("WEBSITE");
  const [newResourceUrl, setNewResourceUrl] = useState("");
  const [newResourceIsPrimary, setNewResourceIsPrimary] = useState(false);
  const [resourceFileUploadProgress, setResourceFileUploadProgress] = useState<number | null>(null);

  const [editingResourceId, setEditingResourceId] = useState<string | null>(null);
  const [editResourceTitle, setEditResourceTitle] = useState("");
  const [editResourceProvider, setEditResourceProvider] = useState<CourseResourceProvider>("WEBSITE");
  const [editResourceUrl, setEditResourceUrl] = useState("");
  const [editResourceIsPrimary, setEditResourceIsPrimary] = useState(false);

  // Draft for the VIDEO/EXTERNAL/DOCUMENT "Main Content" block below - a
  // lesson's primary resource IS the lesson for those types (see
  // backend/training/models.py's CourseResource docstring), so it gets its
  // own prominent editor instead of living buried in the generic Resources
  // list further down the page like every other (supplementary) resource.
  const [mainResourceProvider, setMainResourceProvider] = useState<CourseResourceProvider>("YOUTUBE");
  const [mainResourceUrl, setMainResourceUrl] = useState("");
  const [isSavingMainResource, setIsSavingMainResource] = useState(false);
  const [mainResourceFileUploadProgress, setMainResourceFileUploadProgress] = useState<number | null>(null);

  // Always resyncs every local draft field from the server's response, not
  // just `lesson` itself - DRF's CharField trims whitespace server-side by
  // default, so a title/description saved with a stray trailing space would
  // otherwise leave the local draft permanently mismatched against the saved
  // `lesson.title` (isDirty comparing them would never go false again, even
  // though the save genuinely succeeded - the Save button would stay
  // enabled forever). Used after both the initial load and every save.
  function applyLessonToState(data: LessonDetail) {
    setLesson(data);
    setTitle(data.title);
    setShortDescription(data.short_description);
    setLessonType(data.lesson_type);
    setContent(data.content);
    setEstimatedMinutes(data.estimated_minutes);
    setIsRequired(data.is_required);
    const primary = data.resources.find((resource) => resource.is_primary) ?? null;
    const defaultProvider = data.lesson_type === "DOCUMENT" ? "GOOGLE_DRIVE" : "YOUTUBE";
    setMainResourceProvider((primary?.resource_type === "EXTERNAL_LINK" && primary.provider) || defaultProvider);
    setMainResourceUrl(primary?.resource_type === "EXTERNAL_LINK" ? primary.url : "");
  }

  function loadLesson() {
    return getLesson(lessonId).then((data) => {
      applyLessonToState(data);
      return data;
    });
  }

  useEffect(() => {
    loadLesson().catch((err) => setError(err instanceof Error ? err.message : String(err)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lessonId]);

  if (!lesson) {
    return <p className="font-body-md text-body-md text-on-surface-variant">{t("loading")}</p>;
  }

  const primaryResource = lesson.resources.find((resource) => resource.is_primary) ?? null;
  const isDocumentLessonType = lessonType === "DOCUMENT";
  // VIDEO/EXTERNAL only take over the link path - an existing primary
  // resource that predates this editor could still be a STORED_FILE for
  // those two types, so this falls back to the generic Resources list below
  // rather than hiding a file-backed primary resource with no way left to
  // manage it. DOCUMENT handles both a link (e.g. Drive) AND an uploaded
  // file natively (see the FileDropzone in the block below), so it always
  // takes over regardless of which one the current primary resource is.
  const showMainContentEditor =
    isDocumentLessonType ||
    ((lessonType === "VIDEO" || lessonType === "EXTERNAL") &&
      (!primaryResource || primaryResource.resource_type === "EXTERNAL_LINK"));
  const listedResources = showMainContentEditor
    ? lesson.resources.filter((resource) => !resource.is_primary)
    : lesson.resources;
  const isMainResourceDirty =
    !primaryResource ||
    primaryResource.resource_type !== "EXTERNAL_LINK" ||
    mainResourceProvider !== primaryResource.provider ||
    mainResourceUrl.trim() !== primaryResource.url;

  const isDirty =
    title !== lesson.title ||
    shortDescription !== lesson.short_description ||
    lessonType !== lesson.lesson_type ||
    content !== lesson.content ||
    estimatedMinutes !== lesson.estimated_minutes ||
    isRequired !== lesson.is_required;

  async function runAction<T>(action: () => Promise<T>) {
    setError(null);
    try {
      await action();
      await loadLesson();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleSave() {
    setIsSaving(true);
    setError(null);
    try {
      const updated = await updateLesson(lesson!.id, {
        title,
        short_description: shortDescription,
        lesson_type: lessonType,
        content,
        estimated_minutes: estimatedMinutes,
        is_required: isRequired,
      });
      applyLessonToState(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleSaveMainResource() {
    if (!mainResourceUrl.trim()) return;
    setIsSavingMainResource(true);
    setError(null);
    try {
      const payload = {
        title: title.trim() || lessonTypeT(lessonType),
        resource_type: "EXTERNAL_LINK" as const,
        provider: mainResourceProvider,
        url: mainResourceUrl.trim(),
        // Explicit null - clears a previously-uploaded file when switching
        // this DOCUMENT lesson's main content from an upload to a link;
        // the backend's _validate_resource_fields rejects an EXTERNAL_LINK
        // resource that still carries a stored_file.
        stored_file_id: null,
        is_primary: true,
      };
      if (primaryResource) {
        await updateResource(primaryResource.id, payload);
      } else {
        await createResource(lesson!.id, payload);
      }
      await loadLesson();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSavingMainResource(false);
    }
  }

  async function handleUploadMainResourceFile(file: File) {
    setMainResourceFileUploadProgress(0);
    setError(null);
    try {
      const uploaded = await uploadFile(file, { onProgress: setMainResourceFileUploadProgress });
      const payload = {
        title: title.trim() || file.name,
        resource_type: "STORED_FILE" as const,
        stored_file_id: uploaded.id,
        // Explicit clears - required the other direction from
        // handleSaveMainResource's stored_file_id: null above, same reason.
        provider: "" as CourseResourceProvider,
        url: "",
        is_primary: true,
      };
      if (primaryResource) {
        await updateResource(primaryResource.id, payload);
      } else {
        await createResource(lesson!.id, payload);
      }
      await loadLesson();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setMainResourceFileUploadProgress(null);
    }
  }

  async function handleAddObjective() {
    if (!newObjectiveText.trim()) return;
    await runAction(() => createObjective(lesson!.id, newObjectiveText.trim()));
    setNewObjectiveText("");
  }

  async function handleMoveObjective(objectiveId: string, direction: -1 | 1) {
    const order = lesson!.objectives.map((objective) => objective.id);
    const index = order.indexOf(objectiveId);
    const swapWith = index + direction;
    if (swapWith < 0 || swapWith >= order.length) return;
    [order[index], order[swapWith]] = [order[swapWith], order[index]];
    await runAction(() => reorderObjectives(lesson!.id, order));
  }

  function startEditObjective(objectiveId: string, text: string) {
    setEditingObjectiveId(objectiveId);
    setEditObjectiveText(text);
  }

  function cancelEditObjective() {
    setEditingObjectiveId(null);
  }

  async function handleSaveObjectiveEdit(objectiveId: string) {
    if (!editObjectiveText.trim()) return;
    await runAction(() => updateObjective(objectiveId, editObjectiveText.trim()));
    setEditingObjectiveId(null);
  }

  async function handleAddResource() {
    if (!newResourceTitle.trim()) return;
    await runAction(() =>
      createResource(lesson!.id, {
        title: newResourceTitle.trim(),
        resource_type: "EXTERNAL_LINK",
        provider: newResourceProvider,
        url: newResourceUrl.trim(),
        is_primary: !showMainContentEditor && newResourceIsPrimary,
      }),
    );
    setNewResourceTitle("");
    setNewResourceUrl("");
    setNewResourceIsPrimary(false);
  }

  async function handleAddFileResource(file: File) {
    setResourceFileUploadProgress(0);
    setError(null);
    try {
      const uploaded = await uploadFile(file, { onProgress: setResourceFileUploadProgress });
      await createResource(lesson!.id, {
        title: newResourceTitle.trim() || file.name,
        resource_type: "STORED_FILE",
        stored_file_id: uploaded.id,
        is_primary: !showMainContentEditor && newResourceIsPrimary,
      });
      await loadLesson();
      setNewResourceTitle("");
      setNewResourceIsPrimary(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setResourceFileUploadProgress(null);
    }
  }

  async function handleMoveResource(resourceId: string, direction: -1 | 1) {
    const order = lesson!.resources.map((resource) => resource.id);
    const index = order.indexOf(resourceId);
    const swapWith = index + direction;
    if (swapWith < 0 || swapWith >= order.length) return;
    [order[index], order[swapWith]] = [order[swapWith], order[index]];
    await runAction(() => reorderResources(lesson!.id, order));
  }

  function startEditResource(resource: CourseResource) {
    setEditingResourceId(resource.id);
    setEditResourceTitle(resource.title);
    setEditResourceProvider(resource.provider || "WEBSITE");
    setEditResourceUrl(resource.url);
    setEditResourceIsPrimary(resource.is_primary);
  }

  function cancelEditResource() {
    setEditingResourceId(null);
  }

  async function handleSaveResourceEdit(resource: CourseResource) {
    if (!editResourceTitle.trim()) return;
    await runAction(() =>
      updateResource(resource.id, {
        title: editResourceTitle.trim(),
        is_primary: editResourceIsPrimary,
        ...(resource.resource_type === "EXTERNAL_LINK"
          ? { provider: editResourceProvider, url: editResourceUrl.trim() }
          : {}),
      }),
    );
    setEditingResourceId(null);
  }

  return (
    <div className="max-w-[800px] mx-auto space-y-6">
      <div className="flex items-center justify-between gap-3">
        <Link
          href={`/training/manage/courses/${id}`}
          className="inline-flex items-center gap-1 font-label-caps text-label-caps uppercase text-on-surface-variant hover:text-on-surface transition-colors"
        >
          <Icon name="arrow_back" size={16} />
          {t("backToCourse")}
        </Link>
        <Link href={`/training/courses/${id}/learn/${lessonId}`}>
          <IconButton icon="visibility" variant="secondary" aria-label={t("previewButton")} />
        </Link>
      </div>

      {error && (
        <p className="font-body-md text-body-md text-error" role="alert">
          {error}
        </p>
      )}

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
        <div className="flex flex-wrap items-center gap-4">
          <div className="w-48">
            <Combobox
              label={t("typeLabel")}
              options={LESSON_TYPES.map((value) => ({ value, label: lessonTypeT(value), ...LESSON_TYPE_ICONS[value] }))}
              value={lessonType}
              onChange={(value) => setLessonType(value as LessonType)}
            />
          </div>
          <div className="w-40">
            <label className="block font-label-caps text-label-caps text-on-surface-variant uppercase mb-2">
              {t("estimatedMinutesLabel")}
            </label>
            <input
              type="number"
              min={0}
              className="block w-full px-4 py-2 font-body-md text-body-md text-on-surface bg-surface border border-outline-variant rounded-lg focus:ring-1 focus:ring-primary focus:border-primary outline-none transition-colors"
              value={estimatedMinutes}
              onChange={(e) => setEstimatedMinutes(Number(e.target.value) || 0)}
            />
          </div>
          <label className="flex items-center gap-2 font-body-md text-body-md text-on-surface pt-6">
            <input type="checkbox" checked={isRequired} onChange={(e) => setIsRequired(e.target.checked)} />
            {t("requiredToggleLabel")}
          </label>
        </div>

        {showMainContentEditor && (
          <div className="space-y-3 p-4 rounded-xl border border-primary bg-surface">
            <div>
              <label className="block font-label-caps text-label-caps text-primary uppercase">
                {t("mainContentLabel")}
              </label>
              <p className="font-body-md text-body-md text-on-surface-variant">{t("mainContentHint")}</p>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-40">
                <Combobox
                  label={resourceT("providerLabel")}
                  options={PROVIDERS.map((value) => ({ value, label: resourceT(`provider_${value}` as never), ...RESOURCE_PROVIDER_ICONS[value] }))}
                  value={mainResourceProvider}
                  onChange={(value) => setMainResourceProvider(value as CourseResourceProvider)}
                />
              </div>
              <input
                className="flex-1 min-w-[220px] px-3 py-2 font-body-md text-body-md text-on-surface bg-surface-container border border-outline-variant rounded-lg focus:ring-1 focus:ring-primary focus:border-primary outline-none transition-colors"
                placeholder={resourceT("urlPlaceholder")}
                value={mainResourceUrl}
                onChange={(e) => setMainResourceUrl(e.target.value)}
              />
              <Button
                onClick={handleSaveMainResource}
                disabled={isSavingMainResource || !mainResourceUrl.trim() || !isMainResourceDirty}
              >
                {commonT("save")}
              </Button>
            </div>
            {isDocumentLessonType && (
              <div className="flex items-center gap-2 pt-1">
                <span className="font-body-md text-body-md text-on-surface-variant">or</span>
                <FileDropzone
                  onFileSelected={handleUploadMainResourceFile}
                  progress={mainResourceFileUploadProgress}
                  fileName={primaryResource?.resource_type === "STORED_FILE" ? primaryResource.stored_file?.original_filename : null}
                  label={resourceT("uploadButton")}
                  className="flex-1 max-w-sm"
                />
              </div>
            )}
          </div>
        )}

        <MarkdownEditor
          value={content}
          onChange={setContent}
          placeholder={showMainContentEditor ? t("additionalNotesPlaceholder") : t("contentPlaceholder")}
        />

        <Button onClick={handleSave} disabled={isSaving || !isDirty || !title.trim()}>
          {t("saveButton")}
        </Button>
      </div>

      <div className="space-y-3">
        <h2 className="font-headline-md text-headline-md text-on-surface">{t("objectivesTitle")}</h2>
        <ul className="space-y-1">
          {lesson.objectives.map((objective, index) =>
            editingObjectiveId === objective.id ? (
              <li
                key={objective.id}
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-surface-container-low border border-primary"
              >
                <input
                  autoFocus
                  className="flex-1 px-3 py-1.5 font-body-md text-body-md text-on-surface bg-surface border border-outline-variant rounded-lg focus:ring-1 focus:ring-primary focus:border-primary outline-none transition-colors"
                  value={editObjectiveText}
                  onChange={(e) => setEditObjectiveText(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSaveObjectiveEdit(objective.id)}
                />
                <Button variant="secondary" onClick={cancelEditObjective}>
                  {commonT("cancel")}
                </Button>
                <Button onClick={() => handleSaveObjectiveEdit(objective.id)} disabled={!editObjectiveText.trim()}>
                  {commonT("save")}
                </Button>
              </li>
            ) : (
              <li key={objective.id} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-surface-container-low border border-outline-variant">
                <span className="flex-1 font-body-md text-body-md text-on-surface">{objective.text}</span>
                <IconButton icon="edit" size={16} aria-label={t("editObjective")} onClick={() => startEditObjective(objective.id, objective.text)} />
                <IconButton icon="arrow_upward" size={16} aria-label={t("moveUp")} disabled={index === 0} onClick={() => handleMoveObjective(objective.id, -1)} />
                <IconButton icon="arrow_downward" size={16} aria-label={t("moveDown")} disabled={index === lesson.objectives.length - 1} onClick={() => handleMoveObjective(objective.id, 1)} />
                <IconButton icon="close" size={16} variant="danger" aria-label={t("removeObjective")} onClick={() => runAction(() => deleteObjective(objective.id))} />
              </li>
            ),
          )}
        </ul>
        <div className="flex items-center gap-2">
          <input
            className="flex-1 px-4 py-2 font-body-md text-body-md text-on-surface bg-surface border border-outline-variant rounded-lg focus:ring-1 focus:ring-primary focus:border-primary outline-none transition-colors"
            placeholder={t("objectivePlaceholder")}
            value={newObjectiveText}
            onChange={(e) => setNewObjectiveText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAddObjective()}
          />
          <Button variant="secondary" onClick={handleAddObjective} disabled={!newObjectiveText.trim()}>
            {t("addObjectiveButton")}
          </Button>
        </div>
      </div>

      <div className="space-y-3">
        <h2 className="font-headline-md text-headline-md text-on-surface">{t("resourcesTitle")}</h2>
        <ul className="space-y-1">
          {listedResources.map((resource, index) =>
            editingResourceId === resource.id ? (
              <li
                key={resource.id}
                className="space-y-2 px-3 py-3 rounded-lg bg-surface-container-low border border-primary"
              >
                <input
                  className="w-full px-3 py-2 font-body-md text-body-md text-on-surface bg-surface border border-outline-variant rounded-lg focus:ring-1 focus:ring-primary focus:border-primary outline-none transition-colors"
                  placeholder={resourceT("titlePlaceholder")}
                  value={editResourceTitle}
                  onChange={(e) => setEditResourceTitle(e.target.value)}
                />
                {resource.resource_type === "EXTERNAL_LINK" && (
                  <div className="flex flex-wrap items-end gap-3">
                    <div className="w-40">
                      <Combobox
                        label={resourceT("providerLabel")}
                        options={PROVIDERS.map((value) => ({ value, label: resourceT(`provider_${value}` as never), ...RESOURCE_PROVIDER_ICONS[value] }))}
                        value={editResourceProvider}
                        onChange={(value) => setEditResourceProvider(value as CourseResourceProvider)}
                      />
                    </div>
                    <input
                      className="flex-1 min-w-[200px] px-3 py-2 font-body-md text-body-md text-on-surface bg-surface border border-outline-variant rounded-lg focus:ring-1 focus:ring-primary focus:border-primary outline-none transition-colors"
                      placeholder={resourceT("urlPlaceholder")}
                      value={editResourceUrl}
                      onChange={(e) => setEditResourceUrl(e.target.value)}
                    />
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 font-body-md text-body-md text-on-surface">
                    <input
                      type="checkbox"
                      checked={editResourceIsPrimary}
                      onChange={(e) => setEditResourceIsPrimary(e.target.checked)}
                    />
                    {resourceT("primaryLabel")}
                  </label>
                  <div className="flex items-center gap-2">
                    <Button variant="secondary" onClick={cancelEditResource}>
                      {commonT("cancel")}
                    </Button>
                    <Button onClick={() => handleSaveResourceEdit(resource)} disabled={!editResourceTitle.trim()}>
                      {commonT("save")}
                    </Button>
                  </div>
                </div>
              </li>
            ) : (
              <li key={resource.id} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-surface-container-low border border-outline-variant">
                <Icon name={resource.resource_type === "STORED_FILE" ? "description" : "link"} size={16} className="text-on-surface-variant shrink-0" />
                <span className="flex-1 min-w-0 truncate font-body-md text-body-md text-on-surface">{resource.title}</span>
                {resource.is_primary && (
                  <span className="font-label-caps text-label-caps text-primary uppercase shrink-0">{resourceT("primaryLabel")}</span>
                )}
                <IconButton icon="edit" size={16} aria-label={t("editResource")} onClick={() => startEditResource(resource)} />
                <IconButton icon="arrow_upward" size={16} aria-label={t("moveUp")} disabled={index === 0} onClick={() => handleMoveResource(resource.id, -1)} />
                <IconButton icon="arrow_downward" size={16} aria-label={t("moveDown")} disabled={index === listedResources.length - 1} onClick={() => handleMoveResource(resource.id, 1)} />
                <IconButton icon="close" size={16} variant="danger" aria-label={t("removeResource")} onClick={() => runAction(() => deleteResource(resource.id))} />
              </li>
            ),
          )}
        </ul>

        <div className="space-y-2 bg-surface-container-low border border-outline-variant rounded-xl p-4">
          <div className="flex flex-wrap items-center gap-3">
            <input
              className="flex-1 min-w-[160px] px-3 py-2 font-body-md text-body-md text-on-surface bg-surface border border-outline-variant rounded-lg focus:ring-1 focus:ring-primary focus:border-primary outline-none transition-colors"
              placeholder={resourceT("titlePlaceholder")}
              value={newResourceTitle}
              onChange={(e) => setNewResourceTitle(e.target.value)}
            />
            {!showMainContentEditor && (
              <label className="flex items-center gap-2 font-body-md text-body-md text-on-surface">
                <input type="checkbox" checked={newResourceIsPrimary} onChange={(e) => setNewResourceIsPrimary(e.target.checked)} />
                {resourceT("primaryLabel")}
              </label>
            )}
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-40">
              <Combobox
                label={resourceT("providerLabel")}
                options={PROVIDERS.map((value) => ({ value, label: resourceT(`provider_${value}` as never), ...RESOURCE_PROVIDER_ICONS[value] }))}
                value={newResourceProvider}
                onChange={(value) => setNewResourceProvider(value as CourseResourceProvider)}
              />
            </div>
            <input
              className="flex-1 min-w-[200px] px-3 py-2 font-body-md text-body-md text-on-surface bg-surface border border-outline-variant rounded-lg focus:ring-1 focus:ring-primary focus:border-primary outline-none transition-colors"
              placeholder={resourceT("urlPlaceholder")}
              value={newResourceUrl}
              onChange={(e) => setNewResourceUrl(e.target.value)}
            />
            <Button variant="secondary" onClick={handleAddResource} disabled={!newResourceTitle.trim() || !newResourceUrl.trim()}>
              {resourceT("addButton")}
            </Button>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <span className="font-body-md text-body-md text-on-surface-variant">or</span>
            <FileDropzone
              onFileSelected={handleAddFileResource}
              progress={resourceFileUploadProgress}
              label={resourceT("uploadButton")}
              className="flex-1 max-w-sm"
            />
          </div>
        </div>
      </div>

      <RelatedKnowledgePanel lessonId={lesson.id} canEdit />
    </div>
  );
}
