"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Combobox } from "@/components/ui/Combobox";
import { MarkdownEditor } from "@/components/ui/MarkdownEditor";
import { TagInput } from "@/components/ui/TagInput";
import { useRouter } from "@/i18n/navigation";
import { createProject, updateProject, type ProjectWritePayload } from "@/lib/api/engineering";
import type { ProjectDetail, ProjectStatus } from "@/lib/api/types";

const STATUS_VALUES: ProjectStatus[] = ["ACTIVE", "ON_HOLD", "COMPLETED"];

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
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isDirty =
    name !== (project?.name ?? "") ||
    description !== (project?.description ?? "") ||
    status !== (project?.status ?? "ACTIVE") ||
    tags.join(",") !== (project?.tags.map((tag) => tag.name).join(",") ?? "");

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  function buildPayload(): ProjectWritePayload {
    return { name, description, status, tag_names: tags };
  }

  async function handleSave() {
    setIsSaving(true);
    setError(null);
    try {
      const saved = project ? await updateProject(project.id, buildPayload()) : await createProject(buildPayload());
      router.push(`/projects/${saved.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setIsSaving(false);
    }
  }

  return (
    <div className="space-y-4 max-w-[800px] mx-auto">
      <div className="space-y-4 border-b border-outline-variant pb-4">
        <input
          className="w-full font-headline-lg text-headline-lg font-bold border-none bg-transparent placeholder:text-on-surface-variant/50 focus:ring-0 p-0 text-on-surface outline-none"
          placeholder={t("namePlaceholder")}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <div className="flex flex-wrap gap-3 items-center">
          <TagInput value={tags} onChange={setTags} placeholder={t("tagsPlaceholder")} className="flex-1 min-w-[200px]" />
          <div className="w-48">
            <Combobox
              placeholder={t("statusLabel")}
              options={STATUS_VALUES.map((value) => ({ value, label: statusT(value) }))}
              value={status}
              onChange={(value) => setStatus(value as ProjectStatus)}
            />
          </div>
        </div>
      </div>

      <MarkdownEditor value={description} onChange={setDescription} placeholder={t("descriptionPlaceholder")} />

      {error && (
        <p className="font-body-md text-body-md text-error" role="alert">
          {error}
        </p>
      )}

      <div className="flex items-center gap-3">
        <Button onClick={handleSave} disabled={isSaving || !name.trim()}>
          {isSaving ? commonT("saving") : commonT("save")}
        </Button>
      </div>
    </div>
  );
}
