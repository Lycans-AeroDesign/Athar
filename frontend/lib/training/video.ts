// Google Drive/YouTube embedding is a narrow, whitelisted exception to the "never render raw
// HTML/iframes from user content" rule (components/ui/Markdown.tsx never uses rehype-raw). These
// functions only return a URL built from a validated id (a regex-matched Drive file id, or a
// YouTube id parsed off a real URL), and LessonContent.tsx is the only place rendering an <iframe>
// from resource data. The URL is never fetched server-side (SSRF is out of scope for Training).
import type { CourseResourceProvider } from "@/lib/api/types";

/** Whether `url`'s host is one of `domains` or a subdomain of one. A parsed,
 * dot-anchored comparison - a substring/endsWith check would also accept
 * look-alikes such as "evilsharepoint.com" or "example.com/?youtube.com". */
export function hostMatches(url: string, domains: readonly string[]): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return domains.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

const PROVIDER_DOMAINS: [CourseResourceProvider, readonly string[]][] = [
  ["YOUTUBE", ["youtube.com", "youtu.be"]],
  ["GOOGLE_DRIVE", ["drive.google.com"]],
  ["VIMEO", ["vimeo.com"]],
  ["GITHUB", ["github.com"]],
];

/** The resource provider a link belongs to (by host), else WEBSITE. */
export function detectResourceProvider(url: string): CourseResourceProvider {
  return PROVIDER_DOMAINS.find(([, domains]) => hostMatches(url, domains))?.[0] ?? "WEBSITE";
}

export const SHAREPOINT_DOMAINS = ["sharepoint.com", "1drv.ms", "onedrive.live.com", "officeapps.live.com"] as const;

const DRIVE_FILE_PATTERN = /^https:\/\/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)\/(?:view|preview)/;

export function getGoogleDriveEmbedUrl(url: string): string | null {
  const match = DRIVE_FILE_PATTERN.exec(url);
  if (!match) return null;
  return `https://drive.google.com/file/d/${match[1]}/preview`;
}

const YOUTUBE_ID_PATTERN = /^[a-zA-Z0-9_-]{11}$/;

export function getYoutubeEmbedUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.replace(/^(www|m)\./, "");
  let videoId: string | null = null;
  if (host === "youtu.be") {
    videoId = parsed.pathname.slice(1);
  } else if (host === "youtube.com") {
    if (parsed.pathname === "/watch") {
      videoId = parsed.searchParams.get("v");
    } else if (parsed.pathname.startsWith("/embed/")) {
      videoId = parsed.pathname.slice("/embed/".length);
    } else if (parsed.pathname.startsWith("/shorts/")) {
      videoId = parsed.pathname.slice("/shorts/".length);
    }
  }
  if (!videoId || !YOUTUBE_ID_PATTERN.test(videoId)) return null;
  return `https://www.youtube.com/embed/${videoId}`;
}

export function getSharePointEmbedUrl(rawUrl: string): string | null {
  if (!rawUrl) return null;
  // Handle case where user pasted the full <iframe ... src="..."> tag
  const iframeMatch = rawUrl.match(/src=["'](https?:\/\/[^"']+)["']/i);
  const url = iframeMatch ? iframeMatch[1] : rawUrl.trim();

  try {
    const parsed = new URL(url);
    if (hostMatches(url, SHAREPOINT_DOMAINS)) {
      const pathname = parsed.pathname.toLowerCase();
      const search = parsed.search.toLowerCase();
      if (
        pathname.includes("/embed.aspx") ||
        pathname.includes("/embed") ||
        search.includes("action=embedview") ||
        pathname.startsWith("/op/embed.aspx")
      ) {
        return url;
      }
    }
  } catch {
    return null;
  }
  return null;
}

/** Tried in this order to resolve an embeddable URL across YouTube, Google Drive,
 * and Microsoft SharePoint / OneDrive / Office 365 embed URLs. */
export function getVideoEmbedUrl(url: string): string | null {
  return getYoutubeEmbedUrl(url) ?? getGoogleDriveEmbedUrl(url) ?? getSharePointEmbedUrl(url);
}
