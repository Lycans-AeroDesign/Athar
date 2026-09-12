"use client";

import { useTranslations } from "next-intl";

import { Icon } from "@/components/ui/Icon";
import { downloadFile } from "@/lib/api/files";
import type { CourseResource } from "@/lib/api/types";

/** Supplementary resources below the main lesson content - the primary
 * resource for VIDEO/DOCUMENT/EXTERNAL lessons is rendered inline by
 * LessonContent instead, so callers filter it out of `resources` first. */
export function LessonResourceList({ resources }: { resources: CourseResource[] }) {
  const t = useTranslations("training.lesson");
  if (resources.length === 0) return null;

  return (
    <div className="space-y-2">
      <h3 className="font-headline-md text-headline-md text-on-surface">{t("resourcesTitle")}</h3>
      <ul className="space-y-1">
        {resources.map((resource) => (
          <li key={resource.id}>
            <button
              type="button"
              onClick={() => {
                if (resource.resource_type === "STORED_FILE" && resource.stored_file) {
                  void downloadFile(resource.stored_file.id, resource.stored_file.original_filename);
                } else if (resource.url) {
                  window.open(resource.url, "_blank", "noopener,noreferrer");
                }
              }}
              className="flex items-center gap-2 w-full text-start px-3 py-2 rounded-lg hover:bg-surface-variant transition-colors"
            >
              <Icon
                name={resource.resource_type === "STORED_FILE" ? "description" : "link"}
                size={16}
                className="text-on-surface-variant shrink-0"
              />
              <span className="flex-1 min-w-0">
                <span className="block font-body-md text-body-md text-on-surface truncate">{resource.title}</span>
                {resource.description && (
                  <span className="block font-label-caps text-label-caps text-on-surface-variant truncate">
                    {resource.description}
                  </span>
                )}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
