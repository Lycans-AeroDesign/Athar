"use client";

import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { useState } from "react";

import { PROJECT_STATUS_CLASSES } from "@/components/engineering/statusClasses";
import { Attachments } from "@/components/knowledge/Attachments";
import { ContributorsRow } from "@/components/knowledge/Contributors";
import { RelatedContent } from "@/components/knowledge/RelatedContent";
import { BookmarkButton } from "@/components/ui/BookmarkButton";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { DetailMessage } from "@/components/ui/DetailMessage";
import { Icon } from "@/components/ui/Icon";
import { IconButton } from "@/components/ui/IconButton";
import { Markdown } from "@/components/ui/Markdown";
import { DetailPageSkeleton } from "@/components/ui/Skeleton";
import { TagChip } from "@/components/ui/TagChip";
import { Link, useRouter } from "@/i18n/navigation";
import { deleteProject, getProject } from "@/lib/api/engineering";
import { useHasPermission } from "@/lib/auth/permissions";
import { errorMessage } from "@/lib/errors";
import { useResource } from "@/lib/useResource";

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations("engineering.project");
  const statusT = useTranslations("engineering.projectStatus");
  const router = useRouter();
  const canUpdate = useHasPermission("project.update");
  const canDelete = useHasPermission("project.delete");

  const { data: project, notFound } = useResource(id, getProject);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  if (notFound) {
    return <DetailMessage error>{t("notFound")}</DetailMessage>;
  }
  if (!project) {
    return <DetailPageSkeleton />;
  }

  async function handleDelete() {
    setActionError(null);
    try {
      await deleteProject(project!.id);
      router.push("/projects");
    } catch (err) {
      setActionError(errorMessage(err));
    }
  }

  return (
    <div className="flex flex-col lg:flex-row gap-8 items-start">
    <div className="flex-1 w-full min-w-0 max-w-[800px] space-y-6">
      <Link
        href="/projects"
        className="inline-flex items-center gap-1 font-label-caps text-label-caps uppercase text-on-surface-variant hover:text-on-surface transition-colors"
      >
        <Icon name="arrow_back" size={16} />
        {t("backToList")}
      </Link>

      <div className="border-t-4 border-primary rounded-t-xl bg-surface pt-6 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <span
            className={`font-label-caps text-label-caps uppercase rounded-full px-2.5 py-1 ${PROJECT_STATUS_CLASSES[project.status]}`}
          >
            {statusT(project.status)}
          </span>
          <div className="flex items-center gap-2">
            <BookmarkButton key={project.id} type="project" objectId={project.id} bookmarkId={project.bookmark_id} />
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
        <div className="flex items-center gap-3">
          <h1 className="font-display text-display text-on-surface">{project.name}</h1>
          {project.visibility === "RESTRICTED" && (
            <span className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-error-container text-on-error-container font-label-caps text-label-caps uppercase">
              <Icon name="lock" size={12} />
              {t("visibilityRESTRICTED")}
            </span>
          )}
        </div>
        {project.tags.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {project.tags.map((tag) => (
              <TagChip key={tag.id} tag={tag} />
            ))}
          </div>
        )}
        <ContributorsRow contributors={project.contributors} />
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

    <RelatedContent type="project" id={project.id} canEdit={canUpdate} />
    </div>
  );
}
