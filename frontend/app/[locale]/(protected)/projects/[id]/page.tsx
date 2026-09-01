"use client";

import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { Attachments } from "@/components/knowledge/Attachments";
import { RelatedContent } from "@/components/knowledge/RelatedContent";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Icon } from "@/components/ui/Icon";
import { IconButton } from "@/components/ui/IconButton";
import { Markdown } from "@/components/ui/Markdown";
import { Link, useRouter } from "@/i18n/navigation";
import { deleteProject, getProject } from "@/lib/api/engineering";
import type { ProjectDetail, ProjectStatus } from "@/lib/api/types";
import { useHasPermission } from "@/lib/auth/permissions";

const STATUS_CLASSES: Record<ProjectStatus, string> = {
  ACTIVE: "bg-primary-container text-on-primary-container",
  ON_HOLD: "bg-tertiary-container text-on-tertiary-container",
  COMPLETED: "bg-surface-variant text-on-surface-variant",
};

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations("engineering.project");
  const statusT = useTranslations("engineering.projectStatus");
  const router = useRouter();
  const canUpdate = useHasPermission("project.update");
  const canDelete = useHasPermission("project.delete");

  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    getProject(id).then(setProject, () => setNotFound(true));
  }, [id]);

  if (notFound) {
    return <p className="font-body-md text-body-md text-error">{t("notFound")}</p>;
  }
  if (!project) {
    return <p className="font-body-md text-body-md text-on-surface-variant">{t("loading")}</p>;
  }

  async function handleDelete() {
    setActionError(null);
    try {
      await deleteProject(project!.id);
      router.push("/projects");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="max-w-[800px] mx-auto space-y-6">
      <Link
        href="/projects"
        className="inline-flex items-center gap-1 font-label-caps text-label-caps uppercase text-on-surface-variant hover:text-on-surface transition-colors"
      >
        <Icon name="arrow_back" size={16} />
        {t("backToList")}
      </Link>

      <div className="border-t-4 border-primary rounded-t-xl bg-surface pt-6 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <span
            className={`font-label-caps text-label-caps uppercase rounded-full px-2.5 py-1 ${STATUS_CLASSES[project.status]}`}
          >
            {statusT(project.status)}
          </span>
          <div className="flex items-center gap-2">
            {canUpdate && (
              <Link href={`/projects/${project.id}/edit`}>
                <IconButton icon="edit" variant="secondary" aria-label={t("editButton")} />
              </Link>
            )}
            {canDelete && (
              <IconButton icon="delete" variant="danger" aria-label={t("deleteButton")} onClick={() => setDeleteOpen(true)} />
            )}
          </div>
        </div>
        <h1 className="font-display text-display text-on-surface">{project.name}</h1>
        {project.tags.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {project.tags.map((tag) => (
              <span
                key={tag.id}
                className="px-2.5 py-1 rounded-full bg-surface-container-low text-on-surface-variant font-label-caps text-label-caps uppercase border border-outline-variant"
              >
                {tag.name}
              </span>
            ))}
          </div>
        )}
      </div>

      {actionError && (
        <p className="font-body-md text-body-md text-error" role="alert">
          {actionError}
        </p>
      )}

      {project.description ? (
        <Markdown content={project.description} />
      ) : (
        <p className="font-body-md text-body-md text-on-surface-variant">{t("noDescription")}</p>
      )}

      <RelatedContent type="project" id={project.id} canEdit={canUpdate} />

      <Attachments type="project" id={project.id} canEdit={canUpdate} />

      <ConfirmModal
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t("deleteConfirmTitle")}
        description={t("deleteConfirmBody")}
        confirmLabel={t("deleteButton")}
        danger
        onConfirm={handleDelete}
      />
    </div>
  );
}
