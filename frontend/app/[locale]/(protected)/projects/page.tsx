"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Can } from "@/components/auth/Can";
import { Button } from "@/components/ui/Button";
import { Combobox } from "@/components/ui/Combobox";
import { Icon } from "@/components/ui/Icon";
import { Link } from "@/i18n/navigation";
import { getProjects } from "@/lib/api/engineering";
import type { ProjectStatus, ProjectSummary } from "@/lib/api/types";

const STATUS_VALUES: ProjectStatus[] = ["ACTIVE", "ON_HOLD", "COMPLETED"];

const STATUS_CLASSES: Record<ProjectStatus, string> = {
  ACTIVE: "bg-primary-container text-on-primary-container",
  ON_HOLD: "bg-tertiary-container text-on-tertiary-container",
  COMPLETED: "bg-surface-variant text-on-surface-variant",
};

export default function ProjectsPage() {
  const t = useTranslations("engineering.project");
  const statusT = useTranslations("engineering.projectStatus");
  const commonT = useTranslations("common");

  const [statusFilter, setStatusFilter] = useState<ProjectStatus | null>(null);

  // Keyed by the filter it was fetched for, rather than reset with a plain
  // setProjects(null) at the top of the effect below - see
  // knowledge/page.tsx's status-filter effect for why (that pattern runs
  // setState synchronously in the effect body, which React's lint rule flags).
  const [result, setResult] = useState<{ filter: ProjectStatus | null; projects: ProjectSummary[] } | null>(null);
  const projects = result?.filter === statusFilter ? result.projects : null;

  useEffect(() => {
    getProjects(statusFilter ?? undefined).then((fetched) => setResult({ filter: statusFilter, projects: fetched }));
  }, [statusFilter]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-display text-on-surface">{t("listTitle")}</h1>
          <p className="font-body-lg text-body-lg text-on-surface-variant mt-2">{t("listDescription")}</p>
        </div>
        <div className="flex items-end gap-3">
          <div className="w-48">
            <Combobox
              placeholder={statusT("all")}
              options={[
                { value: "", label: statusT("all") },
                ...STATUS_VALUES.map((value) => ({ value, label: statusT(value) })),
              ]}
              value={statusFilter ?? ""}
              onChange={(value) => setStatusFilter((value || null) as ProjectStatus | null)}
            />
          </div>
          <Can permission="project.create">
            <Link href="/projects/new">
              <Button>
                <Icon name="add" size={18} />
                {t("newButton")}
              </Button>
            </Link>
          </Can>
        </div>
      </div>

      {projects === null ? (
        <p className="font-body-md text-body-md text-on-surface-variant">{commonT("loading")}</p>
      ) : projects.length === 0 ? (
        <p className="font-body-md text-body-md text-on-surface-variant">{t("emptyState")}</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {projects.map((project) => (
            <Link
              key={project.id}
              href={`/projects/${project.id}`}
              className="block bg-surface-container-low border border-outline-variant rounded-xl p-4 hover:shadow-[0_1px_3px_0_rgba(0,0,0,0.08)] transition-shadow"
            >
              <div className="flex items-center justify-between mb-2">
                <span
                  className={`font-label-caps text-label-caps uppercase rounded-full px-2.5 py-1 ${STATUS_CLASSES[project.status]}`}
                >
                  {statusT(project.status)}
                </span>
              </div>
              <h3 className="font-headline-md text-headline-md text-primary mb-2">{project.name}</h3>
              {project.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {project.tags.map((tag) => (
                    <span
                      key={tag.id}
                      className="font-mono-sm text-mono-sm text-on-surface-variant bg-surface-container px-2 py-0.5 rounded-full border border-outline-variant"
                    >
                      {tag.name}
                    </span>
                  ))}
                </div>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
