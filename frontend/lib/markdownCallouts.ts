import type { Blockquote, Parent, Root } from "mdast";

export const CALLOUT_TYPES = ["note", "tip", "important", "warning", "caution"] as const;
export type CalloutType = (typeof CALLOUT_TYPES)[number];

// GitHub's alert syntax - `> [!NOTE]` alone on a blockquote's first line.
const MARKER_PATTERN = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*(?:\r?\n|$)/i;

function tagCallout(blockquote: Blockquote) {
  const paragraph = blockquote.children[0];
  if (paragraph?.type !== "paragraph") return;
  const text = paragraph.children[0];
  if (text?.type !== "text") return;
  const match = MARKER_PATTERN.exec(text.value);
  if (!match) return;

  text.value = text.value.slice(match[0].length);
  if (!text.value) paragraph.children.shift();
  // A marker followed by a hard line break ("[!NOTE]\" or two trailing spaces)
  // leaves that break as the paragraph's new first child.
  if (paragraph.children[0]?.type === "break") paragraph.children.shift();
  if (paragraph.children.length === 0) blockquote.children.shift();

  // Rendered as a data-callout attribute on the <blockquote>, which
  // Markdown.tsx's blockquote component reads to pick the callout style.
  blockquote.data = {
    ...blockquote.data,
    hProperties: { ...blockquote.data?.hProperties, dataCallout: match[1].toLowerCase() },
  };
}

function walk(node: Parent) {
  for (const child of node.children) {
    if (child.type === "blockquote") tagCallout(child);
    if ("children" in child) walk(child);
  }
}

/** remark plugin: turns `> [!NOTE]` / `[!TIP]` / `[!IMPORTANT]` / `[!WARNING]` /
 * `[!CAUTION]` blockquotes into callouts, matching GitHub's alert syntax so
 * content stays portable. Any other blockquote is left as a plain quote. */
export function remarkCallouts() {
  return (tree: Root) => walk(tree);
}
