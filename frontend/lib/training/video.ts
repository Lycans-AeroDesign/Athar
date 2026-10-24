// Google Drive/YouTube embedding is a narrow, whitelisted exception to the "never render raw
// HTML/iframes from user content" rule (components/ui/Markdown.tsx never uses rehype-raw). These
// functions only return a URL built from a validated id (a regex-matched Drive file id, or a
// YouTube id parsed off a real URL), and LessonContent.tsx is the only place rendering an <iframe>
// from resource data. The URL is never fetched server-side (SSRF is out of scope for Training).
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
    const host = parsed.hostname.toLowerCase();
    const isSharePointOrOffice =
      host.endsWith("sharepoint.com") ||
      host.endsWith("1drv.ms") ||
      host.endsWith("onedrive.live.com") ||
      host.endsWith("officeapps.live.com");

    if (isSharePointOrOffice) {
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
