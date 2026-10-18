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

/** Tried in this order since a YouTube URL never matches the Drive pattern
 * and vice versa - order has no real effect, it's just one call site for
 * "is this an embeddable video link" instead of two. */
export function getVideoEmbedUrl(url: string): string | null {
  return getYoutubeEmbedUrl(url) ?? getGoogleDriveEmbedUrl(url);
}
