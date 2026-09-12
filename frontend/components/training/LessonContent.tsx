"use client";

import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Markdown } from "@/components/ui/Markdown";
import { downloadFile } from "@/lib/api/files";
import type { CourseResource, LessonDetail } from "@/lib/api/types";
import { getGoogleDriveEmbedUrl } from "@/lib/training/video";

function VideoResource({ resource, openLabel }: { resource: CourseResource; openLabel: string }) {
  if (resource.resource_type !== "EXTERNAL_LINK" || !resource.url) return null;
  const embedUrl = getGoogleDriveEmbedUrl(resource.url);
  if (embedUrl) {
    return (
      <div className="aspect-video w-full rounded-xl overflow-hidden border border-outline-variant bg-surface-container-high">
        {/* The one place in the app that renders an <iframe> - only ever from
            a regex-validated Google Drive file id, never from raw markdown/
            HTML (see lib/training/video.ts's docstring). */}
        <iframe src={embedUrl} className="h-full w-full" allow="autoplay" title={resource.title} />
      </div>
    );
  }
  return (
    <Button variant="secondary" onClick={() => window.open(resource.url, "_blank", "noopener,noreferrer")}>
      <Icon name="play_circle" size={18} />
      {openLabel}
    </Button>
  );
}

function DocumentResource({ resource, openLabel }: { resource: CourseResource; openLabel: string }) {
  if (resource.resource_type === "STORED_FILE" && resource.stored_file) {
    const file = resource.stored_file;
    return (
      <Button variant="secondary" onClick={() => downloadFile(file.id, file.original_filename)}>
        <Icon name="description" size={18} />
        {file.original_filename}
      </Button>
    );
  }
  if (resource.resource_type === "EXTERNAL_LINK" && resource.url) {
    return (
      <Button variant="secondary" onClick={() => window.open(resource.url, "_blank", "noopener,noreferrer")}>
        <Icon name="open_in_new" size={18} />
        {openLabel}
      </Button>
    );
  }
  return null;
}

function ExternalResource({ resource, openLabel }: { resource: CourseResource; openLabel: string }) {
  if (!resource.url) return null;
  return (
    <Button variant="secondary" onClick={() => window.open(resource.url, "_blank", "noopener,noreferrer")}>
      <Icon name="open_in_new" size={18} />
      {openLabel}
    </Button>
  );
}

/** Renders a lesson's primary content by lesson_type (see backend/training/
 * models.py's Lesson.LessonType) - the markdown `content` field renders
 * below the type-specific primary resource for every type, since VIDEO/
 * DOCUMENT/EXTERNAL lessons may still carry supplementary notes (see
 * Lesson.content's docstring). */
export function LessonContent({ lesson }: { lesson: LessonDetail }) {
  const t = useTranslations("training.lesson");
  const primaryResource = lesson.resources.find((resource) => resource.is_primary) ?? null;

  return (
    <div className="space-y-6">
      {lesson.lesson_type === "VIDEO" && primaryResource && (
        <VideoResource resource={primaryResource} openLabel={t("openVideo")} />
      )}
      {lesson.lesson_type === "DOCUMENT" && primaryResource && (
        <DocumentResource resource={primaryResource} openLabel={t("openResource")} />
      )}
      {lesson.lesson_type === "EXTERNAL" && primaryResource && (
        <ExternalResource resource={primaryResource} openLabel={t("openResource")} />
      )}
      {lesson.content && <Markdown content={lesson.content} />}
    </div>
  );
}
