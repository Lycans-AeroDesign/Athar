// Google Drive embedding is a narrow, explicitly-whitelisted exception to
// this app's "never render raw HTML/iframes from user content" rule (see
// components/ui/Markdown.tsx, which never uses rehype-raw). This function
// only ever returns a URL constructed from a regex-validated Drive file id -
// never anything derived from unvalidated user HTML - and the caller
// (LessonVideoContent) is the only place in the app that renders an
// <iframe> from resource data. No server-side fetch of the URL is ever
// performed (SSRF is explicitly out of scope for Training - see the plan's
// §55/§4.3).
const DRIVE_FILE_PATTERN = /^https:\/\/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)\/(?:view|preview)/;

export function getGoogleDriveEmbedUrl(url: string): string | null {
  const match = DRIVE_FILE_PATTERN.exec(url);
  if (!match) return null;
  return `https://drive.google.com/file/d/${match[1]}/preview`;
}
