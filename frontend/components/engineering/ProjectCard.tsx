import { useTranslations } from "next-intl";

import { Avatar } from "@/components/ui/Avatar";
import { Icon } from "@/components/ui/Icon";
import { Skeleton, SkeletonPill, SkeletonRegion, SkeletonText } from "@/components/ui/Skeleton";
import { Link } from "@/i18n/navigation";
import type { ProjectCard as ProjectCardData } from "@/lib/api/types";
import { formatRelativeTime } from "@/lib/datetime";
import { formatPersonName } from "@/lib/format";

import { PROJECT_STATUS_CLASSES } from "./statusClasses";

const MAX_TAGS = 3;

export const PROJECT_CARD_GRID = "grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4";

/** One project on the Projects list: status, title, description excerpt, tags, collaborators and linked work. */
export function ProjectCard({ project }: { project: ProjectCardData }) {
  const t = useTranslations("engineering.project");
  const statusT = useTranslations("engineering.projectStatus");
  const extraTags = project.tags.length - MAX_TAGS;
  const hiddenCollaborators = project.collaborator_count - project.collaborators.length;

  return (
    <Link
      href={`/projects/${project.id}`}
      className="group flex flex-col bg-surface-container-low border border-outline-variant rounded-xl p-4 hover:shadow-[0_1px_3px_0_rgba(0,0,0,0.08)] transition-shadow"
    >
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-1.5">
          <span
            className={`font-label-caps text-label-caps uppercase rounded-full px-2.5 py-1 ${PROJECT_STATUS_CLASSES[project.status]}`}
          >
            {statusT(project.status)}
          </span>
          {project.visibility === "RESTRICTED" && (
            <span
              className="flex items-center text-on-error-container bg-error-container rounded-full p-1"
              title={t("visibilityRESTRICTED")}
              aria-label={t("visibilityRESTRICTED")}
            >
              <Icon name="lock" size={12} />
            </span>
          )}
        </div>
        <span className="flex items-center gap-1 font-mono-sm text-mono-sm text-on-surface-variant shrink-0">
          <Icon name="update" size={14} />
          {formatRelativeTime(project.updated_at)}
        </span>
      </div>

      <h3 className="font-headline-md text-headline-md text-primary line-clamp-2 mb-1 group-hover:underline">
        {project.name}
      </h3>
      {project.excerpt ? (
        <p className="font-body-md text-body-md text-on-surface-variant line-clamp-3 mb-3">{project.excerpt}</p>
      ) : (
        <p className="font-body-md text-body-md text-on-surface-variant/60 italic mb-3">{t("noDescription")}</p>
      )}

      {project.tags.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 mb-3">
          {project.tags.slice(0, MAX_TAGS).map((tag) => (
            <span
              key={tag.id}
              className="font-mono-sm text-mono-sm text-on-surface-variant bg-surface-container px-2 py-0.5 rounded-full border border-outline-variant"
            >
              {tag.name}
            </span>
          ))}
          {extraTags > 0 && (
            <span className="font-mono-sm text-mono-sm text-on-surface-variant">{t("moreTags", { count: extraTags })}</span>
          )}
        </div>
      )}

      <div className="mt-auto flex items-center justify-between gap-3 pt-3 border-t border-outline-variant">
        {project.collaborators.length > 0 ? (
          <div role="group" className="flex items-center min-w-0" aria-label={t("collaboratorsLabel", { count: project.collaborator_count })}>
            <div className="flex -space-x-2 rtl:space-x-reverse">
              {project.collaborators.map((person) => (
                <div
                  key={person.id}
                  title={formatPersonName(person) ?? undefined}
                  className="rounded-full ring-2 ring-surface-container-low"
                >
                  <Avatar person={person} size="sm" />
                </div>
              ))}
            </div>
            {hiddenCollaborators > 0 && (
              <span className="ms-1.5 font-mono-sm text-mono-sm text-on-surface-variant">+{hiddenCollaborators}</span>
            )}
          </div>
        ) : (
          <span className="font-body-md text-body-md text-on-surface-variant/60 italic">{t("noCollaborators")}</span>
        )}
        <div className="flex items-center gap-3 shrink-0 font-mono-sm text-mono-sm text-on-surface-variant">
          <span className="flex items-center gap-1" title={t("testCount", { count: project.test_count })}>
            <Icon name="science" size={14} />
            <span aria-hidden>{project.test_count}</span>
            <span className="sr-only">{t("testCount", { count: project.test_count })}</span>
          </span>
          <span
            className={`flex items-center gap-1 ${project.failure_count > 0 ? "text-error" : ""}`}
            title={t("failureCount", { count: project.failure_count })}
          >
            <Icon name="report_problem" size={14} />
            <span aria-hidden>{project.failure_count}</span>
            <span className="sr-only">{t("failureCount", { count: project.failure_count })}</span>
          </span>
        </div>
      </div>
    </Link>
  );
}

/** Mirrors ProjectCard above, block for block. */
export function ProjectCardGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <SkeletonRegion className={PROJECT_CARD_GRID}>
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="flex flex-col bg-surface-container-low border border-outline-variant rounded-xl p-4">
          <div className="flex items-center justify-between gap-2 mb-3">
            <SkeletonPill className="w-20" />
            <SkeletonText variant="mono-sm" width="w-16" />
          </div>
          <SkeletonText variant="headline-md" width="w-2/3" className="mb-1" />
          <SkeletonText lines={2} width="w-full" lastWidth="w-3/5" className="mb-3" />
          <div className="flex flex-wrap gap-1.5 mb-3">
            <SkeletonPill className="w-14" />
            <SkeletonPill className="w-20" />
          </div>
          <div className="mt-auto flex items-center justify-between gap-3 pt-3 border-t border-outline-variant">
            <div className="flex -space-x-2 rtl:space-x-reverse">
              {[0, 1, 2].map((avatar) => (
                <Skeleton key={avatar} className="h-8 w-8 rounded-full ring-2 ring-surface-container-low" />
              ))}
            </div>
            <SkeletonText variant="mono-sm" width="w-16" />
          </div>
        </div>
      ))}
    </SkeletonRegion>
  );
}
