"use client";

import { useTranslations } from "next-intl";

import { AuthenticatedPdfEmbed } from "@/components/ui/AuthenticatedPdfEmbed";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Markdown } from "@/components/ui/Markdown";
import { downloadFile } from "@/lib/api/files";
import type { CourseResource, LessonDetail } from "@/lib/api/types";
import { getGoogleDriveEmbedUrl, getVideoEmbedUrl } from "@/lib/training/video";

// Shared by VIDEO and EXTERNAL lessons: a YouTube or Google Drive video link
// embeds inline, everything else (a GitHub repo, a plain website, ...) just
// opens in a new tab - there's no way to "preview" an arbitrary URL safely
// (see lib/training/video.ts's docstring on why only these two are
// whitelisted for <iframe> embedding).
function EmbedOrLinkResource({ resource, openLabel, icon }: { resource: CourseResource; openLabel: string; icon: string }) {
  if (resource.resource_type !== "EXTERNAL_LINK" || !resource.url) return null;
  const embedUrl = getVideoEmbedUrl(resource.url);
  if (embedUrl) {
    return (
      <div className="aspect-video w-full rounded-xl overflow-hidden border border-outline-variant bg-surface-container-high">
        {/* The one place in the app that renders an <iframe> - only ever from
            a validated YouTube/Google Drive video id, never from raw
            markdown/HTML (see lib/training/video.ts's docstring). */}
        <iframe
          src={embedUrl}
          className="h-full w-full"
          allow="autoplay; encrypted-media; picture-in-picture"
          allowFullScreen
          title={resource.title}
        />
      </div>
    );
  }
  return (
    <Button variant="secondary" onClick={() => window.open(resource.url, "_blank", "noopener,noreferrer")}>
      <Icon name={icon} size={18} />
      {openLabel}
    </Button>
  );
}

function DocumentResource({ resource, openLabel }: { resource: CourseResource; openLabel: string }) {
  if (resource.resource_type === "STORED_FILE" && resource.stored_file) {
    const file = resource.stored_file;
    if (file.content_type === "application/pdf") {
      return (
        <div className="w-full h-[75vh] rounded-xl overflow-hidden border border-outline-variant bg-surface-container-high">
          <AuthenticatedPdfEmbed src={file.download_url} title={resource.title} className="h-full w-full" />
        </div>
      );
    }
    return (
      <Button variant="secondary" onClick={() => downloadFile(file.id, file.original_filename)}>
        <Icon name="description" size={18} />
        {file.original_filename}
      </Button>
    );
  }
  if (resource.resource_type === "EXTERNAL_LINK" && resource.url) {
    // Google Drive's own /preview iframe renders any file type it hosts, not
    // just video - a Drive-hosted PDF share link embeds exactly the same way
    // a Drive video link does (see EmbedOrLinkResource above).
    const embedUrl = getGoogleDriveEmbedUrl(resource.url);
    if (embedUrl) {
      return (
        <div className="w-full h-[75vh] rounded-xl overflow-hidden border border-outline-variant bg-surface-container-high">
          <iframe src={embedUrl} className="h-full w-full border-0" title={resource.title} />
        </div>
      );
    }
    return (
      <Button variant="secondary" onClick={() => window.open(resource.url, "_blank", "noopener,noreferrer")}>
        <Icon name="open_in_new" size={18} />
        {openLabel}
      </Button>
    );
  }
  return null;
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
        <EmbedOrLinkResource resource={primaryResource} openLabel={t("openVideo")} icon="play_circle" />
      )}
      {lesson.lesson_type === "DOCUMENT" && primaryResource && (
        <DocumentResource resource={primaryResource} openLabel={t("openResource")} />
      )}
      {lesson.lesson_type === "EXTERNAL" && primaryResource && (
        <EmbedOrLinkResource resource={primaryResource} openLabel={t("openResource")} icon="open_in_new" />
      )}
      {lesson.content && <Markdown content={lesson.content} />}
    </div>
  );
}
