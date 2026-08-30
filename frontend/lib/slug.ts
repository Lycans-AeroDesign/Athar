/** Matches the slug a heading gets in Markdown.tsx's h2/h3 renderers, so a
 * table of contents built from the raw markdown source (see lib/toc.ts)
 * links to the same #id the rendered heading actually has. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
