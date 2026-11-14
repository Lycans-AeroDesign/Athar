import type { RelatableType } from "@/lib/api/types";
import { RELATABLE_ROUTE_PREFIX } from "@/lib/knowledgeTypes";

// An "@"-mention is stored as a plain markdown link to the item's page -
// `[Motor](/components/<uuid>)` (see MarkdownEditor's selectMention) - so it
// renders anywhere markdown does with no custom syntax. The editor shows it as
// `@Motor` instead (toDisplay) and turns that back into the link on every edit
// (toStorage); this file is that two-way mapping.

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const PREFIX_TO_TYPE = new Map<string, RelatableType>(
  (Object.entries(RELATABLE_ROUTE_PREFIX) as [RelatableType, string][]).map(([type, prefix]) => [prefix, type]),
);

// Longest prefixes first so "/knowledge/articles" isn't shadowed by a shorter one.
const PREFIX_PATTERN = [...PREFIX_TO_TYPE.keys()]
  .sort((a, b) => b.length - a.length)
  .map(escapeRegExp)
  .join("|");

/** An internal item link, e.g. "/components/<id>" -> { type: "component", id }. */
const MENTION_HREF_RE = new RegExp(`^(${PREFIX_PATTERN})/([A-Za-z0-9-]+)/?$`);

export function parseMentionHref(href: string | undefined): { type: RelatableType; id: string } | null {
  if (!href) return null;
  const match = MENTION_HREF_RE.exec(href);
  if (!match) return null;
  const type = PREFIX_TO_TYPE.get(match[1]);
  return type ? { type, id: match[2] } : null;
}

// `[title](href)` where href is an internal item link - not an image (`![..]`),
// and a title without brackets/newlines so it can round-trip through `@title`.
function mentionLinkRegex(): RegExp {
  return new RegExp(`(?<!!)\\[([^\\[\\]\\n]+)\\]\\(((?:${PREFIX_PATTERN})/[A-Za-z0-9-]+/?)\\)`, "g");
}

/** title -> href for every mention shown as `@title` in the current display text. */
export type MentionMap = Map<string, string>;

export function mentionLink(title: string, href: string): string {
  return `[${title}](${href})`;
}

export function canDisplayAsMention(title: string): boolean {
  return title.length > 0 && !/[[\]\n]/.test(title);
}

export function toStorage(display: string, mentions: MentionMap): string {
  if (mentions.size === 0) return display;
  // Longest titles first, so "@Motor Mount" wins over "@Motor".
  const titles = [...mentions.keys()].sort((a, b) => b.length - a.length);
  const re = new RegExp(`@(${titles.map(escapeRegExp).join("|")})`, "g");
  return display.replace(re, (_, title: string) => mentionLink(title, mentions.get(title)!));
}

function collapse(storage: string, mentions: MentionMap): string {
  return storage.replace(mentionLinkRegex(), (full, title: string, href: string) =>
    mentions.get(title) === href ? `@${title}` : full,
  );
}

/**
 * Collapses mention links into `@title` for the editor. A title is only
 * collapsed when doing so is lossless: every link with that title points at
 * the same item, and the raw text doesn't already contain a literal "@title"
 * that toStorage would wrongly turn into a link. Anything else stays as the
 * raw link, so toStorage(toDisplay(s).display, mentions) === s always holds.
 */
export function toDisplay(storage: string): { display: string; mentions: MentionMap } {
  const hrefsByTitle = new Map<string, Set<string>>();
  for (const match of storage.matchAll(mentionLinkRegex())) {
    const hrefs = hrefsByTitle.get(match[1]) ?? new Set<string>();
    hrefs.add(match[2]);
    hrefsByTitle.set(match[1], hrefs);
  }
  if (hrefsByTitle.size === 0) return { display: storage, mentions: new Map() };

  const withoutLinks = storage.replace(mentionLinkRegex(), "");
  const mentions: MentionMap = new Map();
  for (const [title, hrefs] of hrefsByTitle) {
    if (hrefs.size === 1 && !withoutLinks.includes(`@${title}`)) {
      mentions.set(title, [...hrefs][0]);
    }
  }

  // Overlapping titles ("Motor" next to " Mount" text vs a "Motor Mount" item)
  // can still confuse the reverse mapping - drop titles until it round-trips.
  for (;;) {
    const display = collapse(storage, mentions);
    if (toStorage(display, mentions) === storage) return { display, mentions };
    const shortest = [...mentions.keys()].sort((a, b) => a.length - b.length)[0];
    if (shortest === undefined) return { display: storage, mentions };
    mentions.delete(shortest);
  }
}
