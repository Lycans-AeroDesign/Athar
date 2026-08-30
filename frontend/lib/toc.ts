import { slugify } from "./slug";

export interface TocHeading {
  level: 2 | 3;
  text: string;
  slug: string;
}

/** Table of contents for the article detail page's left sidebar - only ##
 * and ### headings (matching Markdown.tsx's h2/h3), parsed straight from the
 * raw markdown source rather than the rendered DOM. */
export function extractHeadings(markdown: string): TocHeading[] {
  const headings: TocHeading[] = [];
  for (const line of markdown.split("\n")) {
    const match = line.match(/^(#{2,3})\s+(.+)$/);
    if (!match) continue;
    const text = match[2].trim();
    headings.push({ level: match[1].length as 2 | 3, text, slug: slugify(text) });
  }
  return headings;
}
