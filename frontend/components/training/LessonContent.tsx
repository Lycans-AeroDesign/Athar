"use client";

import { useTranslations } from "next-intl";

import { AuthenticatedPdfEmbed } from "@/components/ui/AuthenticatedPdfEmbed";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Markdown } from "@/components/ui/Markdown";
import { downloadFile } from "@/lib/api/files";
import type { CourseResource, LessonDetail } from "@/lib/api/types";
import { getGoogleDriveEmbedUrl, getVideoEmbedUrl } from "@/lib/training/video";

function VideoStreamCard({
  resource,
  title,
  openLabel,
}: {
  resource: CourseResource;
  title: string;
  openLabel: string;
}) {
  const url = resource.url || "";
  const isSharePoint = url.includes("sharepoint.com") || url.includes("1drv.ms");

  return (
    <div className="relative w-full aspect-video min-h-[260px] sm:min-h-[360px] rounded-2xl overflow-hidden border border-outline-variant bg-gradient-to-br from-surface-container-high via-surface-container to-surface-container-lowest flex flex-col items-center justify-center p-6 sm:p-8 text-center group shadow-md transition-all">
      <div className="absolute inset-0 bg-radial from-primary/10 via-transparent to-transparent opacity-60 pointer-events-none" />

      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="relative z-10 flex flex-col items-center gap-4 group/play focus:outline-none"
      >
        <div className="w-20 h-20 rounded-full bg-primary text-on-primary flex items-center justify-center shadow-lg group-hover/play:scale-110 group-hover/play:bg-primary/90 transition-transform duration-300">
          <Icon name="play_arrow" size={38} className="ml-1" />
        </div>

        <div className="space-y-1.5 max-w-lg">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-surface-container-highest border border-outline-variant text-on-surface-variant">
            <Icon name={isSharePoint ? "cloud" : "videocam"} size={14} />
            {isSharePoint ? "Microsoft SharePoint Video" : "External Video Stream"}
          </span>
          <h4 className="font-headline-sm text-headline-sm font-bold text-on-surface line-clamp-2">
            {title || resource.title}
          </h4>
          <p className="font-body-sm text-body-sm text-on-surface-variant">
            {isSharePoint
              ? "Hosted on SharePoint. Click to stream in full resolution with player controls."
              : "Click to stream this video in a new tab."}
          </p>
        </div>
      </a>

      <div className="relative z-10 mt-5">
        <Button
          onClick={() => window.open(url, "_blank", "noopener,noreferrer")}
          className="gap-2 shadow-md"
        >
          <Icon name="open_in_new" size={18} />
          {isSharePoint ? "Open Video in SharePoint" : openLabel}
        </Button>
      </div>
    </div>
  );
}

// Shared by VIDEO and EXTERNAL lessons: a YouTube or Google Drive video link
// embeds inline, everything else (a GitHub repo, a plain website, ...) just
// opens in a new tab - there's no way to "preview" an arbitrary URL safely
// (see lib/training/video.ts's docstring on why only these two are
// whitelisted for <iframe> embedding).
function EmbedOrLinkResource({
  resource,
  lessonTitle,
  openLabel,
  icon,
}: {
  resource: CourseResource;
  lessonTitle?: string;
  openLabel: string;
  icon: string;
}) {
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
          title={resource.title || lessonTitle || "Video"}
        />
      </div>
    );
  }

  // If this is a video lesson or video stream that cannot be iframe-embedded (SharePoint, Vimeo, direct MP4)
  if (icon === "play_circle" || resource.provider === "WEBSITE" || resource.provider === "VIMEO") {
    return <VideoStreamCard resource={resource} title={lessonTitle || resource.title} openLabel={openLabel} />;
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
  let primaryResource = lesson.resources.find((resource) => resource.is_primary) ?? null;

  // Fallback 1: if no primary resource is marked, check if any resource exists
  if (!primaryResource && lesson.resources.length > 0) {
    primaryResource = lesson.resources[0];
  }

  // Fallback 2: if still no resource, but lesson is VIDEO or has a URL in short_description/content
  if (!primaryResource && (lesson.lesson_type === "VIDEO" || lesson.lesson_type === "EXTERNAL")) {
    const rawText = `${lesson.short_description || ""} ${lesson.content || ""}`;
    const match = rawText.match(/https?:\/\/[^\s)]+/);
    if (match) {
      primaryResource = {
        id: "fallback-primary",
        title: lesson.title,
        description: "",
        resource_type: "EXTERNAL_LINK",
        provider: match[0].includes("youtu")
          ? "YOUTUBE"
          : match[0].includes("drive")
            ? "GOOGLE_DRIVE"
            : match[0].includes("vimeo")
              ? "VIMEO"
              : "WEBSITE",
        url: match[0],
        stored_file: null,
        is_primary: true,
        order: 0,
        created_at: "",
        created_by: null,
      };
    }
  }

  // Strip duplicate raw primary URL from markdown content
  let cleanContent = lesson.content || "";
  if (primaryResource?.url) {
    cleanContent = cleanContent.replace(primaryResource.url, "").trim();
  }

  return (
    <div className="space-y-6">
      {lesson.lesson_type === "VIDEO" && primaryResource && (
        <EmbedOrLinkResource
          resource={primaryResource}
          lessonTitle={lesson.title}
          openLabel={t("openVideo")}
          icon="play_circle"
        />
      )}
      {lesson.lesson_type === "DOCUMENT" && primaryResource && (
        <DocumentResource resource={primaryResource} openLabel={t("openResource")} />
      )}
      {lesson.lesson_type === "EXTERNAL" && primaryResource && (
        <EmbedOrLinkResource
          resource={primaryResource}
          lessonTitle={lesson.title}
          openLabel={t("openResource")}
          icon="open_in_new"
        />
      )}
      {cleanContent && <Markdown content={cleanContent} />}
    </div>
  );
}
