"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";
import { ChangedIndicator } from "@/components/ui/ChangedIndicator";
import { Combobox } from "@/components/ui/Combobox";
import { MarkdownEditor } from "@/components/ui/MarkdownEditor";
import { TagInput } from "@/components/ui/TagInput";
import {
  EMPTY_RESTRICTED_ACCESS_DRAFT,
  RestrictedAccessPicker,
  type RestrictedAccessDraft,
} from "@/components/knowledge/RestrictedAccessPicker";
import { useRouter } from "@/i18n/navigation";
import { addAccessGrant, removeAccessGrant } from "@/lib/api/accessGrants";
import { createProject, updateProject, type ProjectWritePayload } from "@/lib/api/engineering";
import type { ProjectDetail, ProjectStatus, Visibility } from "@/lib/api/types";
import { PROJECT_STATUS_ICONS, VISIBILITY_ICONS } from "@/lib/optionIcons";

const STATUS_VALUES: ProjectStatus[] = ["ACTIVE", "ON_HOLD", "COMPLETED"];
const VISIBILITY_VALUES: Visibility[] = ["PUBLIC", "RESTRICTED"];

interface ProjectEditorProps {
  /** Omit to create a new project; pass an existing one to edit it in place. */
  project?: ProjectDetail;
  onDirtyChange?: (dirty: boolean) => void;
}

// Structured like ArticleEditor.tsx - local-state draft, no draft/review
// workflow though (see backend/knowledge/models.py's Project docstring), so
// there's just one Save action, not a status-dependent action row.
export function ProjectEditor({ project, onDirtyChange }: ProjectEditorProps) {
  const t = useTranslations("engineering.project");
  const statusT = useTranslations("engineering.projectStatus");
  const commonT = useTranslations("common");
  const router = useRouter();

  const [name, setName] = useState(project?.name ?? "");
  const [description, setDescription] = useState(project?.description ?? "");
  const [status, setStatus] = useState<ProjectStatus>(project?.status ?? "ACTIVE");
  const [tags, setTags] = useState<string[]>(project?.tags.map((tag) => tag.name) ?? []);
  const [visibility, setVisibility] = useState<Visibility>(project?.visibility ?? "PUBLIC");
  const [restrictedAccessDraft, setRestrictedAccessDraft] = useState<RestrictedAccessDraft>(
    EMPTY_RESTRICTED_ACCESS_DRAFT,
  );
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fieldChanged = {
    name: name !== (project?.name ?? ""),
    description: description !== (project?.description ?? ""),
    status: status !== (project?.status ?? "ACTIVE"),
    tags: tags.join(",") !== (project?.tags.map((tag) => tag.name).join(",") ?? ""),
    visibility: visibility !== (project?.visibility ?? "PUBLIC"),
    restrictedAccess:
      restrictedAccessDraft.pendingAdd.length > 0 || restrictedAccessDraft.pendingRemoveGrantIds.length > 0,
  };

  const isDirty = Object.values(fieldChanged).some(Boolean);

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  function buildPayload(): ProjectWritePayload {
    return { name, description, status, visibility, tag_names: tags };
  }

  async function syncRestrictedAccess(projectId: string) {
    for (const grantId of restrictedAccessDraft.pendingRemoveGrantIds) {
      await removeAccessGrant(grantId);
    }
    for (const user of restrictedAccessDraft.pendingAdd) {
      await addAccessGrant("project", projectId, user.id);
    }
  }

  async function handleSave() {
    setIsSaving(true);
    setError(null);
    try {
      const saved = project ? await updateProject(project.id, buildPayload()) : await createProject(buildPayload());
      await syncRestrictedAccess(saved.id);
      router.push(`/projects/${saved.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setIsSaving(false);
    }
  }

  return (
    <div className="space-y-4 max-w-[800px] mx-auto">
      <div className="space-y-4 border-b border-outline-variant pb-4">
        <ChangedIndicator changed={fieldChanged.name}>
          <input
            className="w-full font-headline-lg text-headline-lg font-bold border-none bg-transparent placeholder:text-on-surface-variant/50 focus:ring-0 p-0 text-on-surface outline-none"
            placeholder={t("namePlaceholder")}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </ChangedIndicator>
        <div className="flex flex-wrap gap-3 items-center">
          <ChangedIndicator changed={fieldChanged.tags} className="flex-1 min-w-[200px]">
            <TagInput value={tags} onChange={setTags} placeholder={t("tagsPlaceholder")} className="w-full" />
          </ChangedIndicator>
          <ChangedIndicator changed={fieldChanged.status} className="w-48">
            <Combobox
              placeholder={t("statusLabel")}
              options={STATUS_VALUES.map((value) => ({ value, label: statusT(value), ...PROJECT_STATUS_ICONS[value] }))}
              value={status}
              onChange={(value) => setStatus(value as ProjectStatus)}
            />
          </ChangedIndicator>
          <ChangedIndicator changed={fieldChanged.visibility} className="w-48">
            <Combobox
              placeholder={t("visibilityLabel")}
              options={VISIBILITY_VALUES.map((value) => ({ value, label: t(`visibility${value}`), ...VISIBILITY_ICONS[value] }))}
              value={visibility}
              onChange={(value) => setVisibility(value as Visibility)}
            />
          </ChangedIndicator>
        </div>
        {visibility === "RESTRICTED" && (
          <ChangedIndicator changed={fieldChanged.restrictedAccess}>
            <RestrictedAccessPicker
              initialGrants={project?.restricted_to ?? []}
              value={restrictedAccessDraft}
              onChange={setRestrictedAccessDraft}
            />
          </ChangedIndicator>
        )}
      </div>

      <ChangedIndicator changed={fieldChanged.description}>
        <MarkdownEditor
          value={description}
          onChange={setDescription}
          placeholder={t("descriptionPlaceholder")}
          relateFrom={project ? { type: "project", id: project.id } : undefined}
        />
      </ChangedIndicator>

      {error && (
        <p className="font-body-md text-body-md text-error" role="alert">
          {error}
        </p>
      )}

      <div className="flex items-center gap-3">
        <Button onClick={handleSave} disabled={isSaving || !name.trim() || (!!project && !isDirty)}>
          {isSaving ? commonT("saving") : commonT("save")}
        </Button>
      </div>
    </div>
  );
}
