"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Combobox } from "@/components/ui/Combobox";
import { getProjects } from "@/lib/api/engineering";
import type { ProjectSummary } from "@/lib/api/types";
import { VISIBILITY_ICONS } from "@/lib/optionIcons";

interface ProjectSelectProps {
  value: string | null;
  /** Reports the full project too (null when cleared) so the caller can read
   * its visibility for the "inherit from project" default. */
  onChange: (id: string | null, project: ProjectSummary | null) => void;
}

// The project picker on every relatable type's creation form. Lists only
// projects the viewer can see (the list endpoint already applies the
// RESTRICTED rule), with each one's visibility icon so it's clear up front
// what "inherit from project" will mean. Includes an explicit "No project"
// option so a pick can be undone.
export function ProjectSelect({ value, onChange }: ProjectSelectProps) {
  const t = useTranslations("creation");
  const [projects, setProjects] = useState<ProjectSummary[]>([]);

  useEffect(() => {
    getProjects({ page_size: 100 })
      .then((data) => setProjects(data.results))
      .catch(() => setProjects([]));
  }, []);

  // Once the list arrives, report the preselected project (e.g. from a
  // ?project= link) so the caller learns its visibility too.
  useEffect(() => {
    if (!value) return;
    const project = projects.find((p) => p.id === value);
    if (project) onChange(value, project);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the list loads, not on every pick.
  }, [projects]);

  const NONE = "__none__";

  return (
    <Combobox
      label={t("projectLabel")}
      placeholder={t("projectPlaceholder")}
      options={[
        { value: NONE, label: t("noProject"), icon: "block" },
        ...projects.map((project) => ({
          value: project.id,
          label: project.name,
          ...VISIBILITY_ICONS[project.visibility],
        })),
      ]}
      value={value}
      onChange={(id) => {
        if (id === NONE) {
          onChange(null, null);
          return;
        }
        onChange(id, projects.find((p) => p.id === id) ?? null);
      }}
    />
  );
}
