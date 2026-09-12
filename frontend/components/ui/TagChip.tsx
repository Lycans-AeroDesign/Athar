import { Link } from "@/i18n/navigation";
import type { Tag } from "@/lib/api/types";

/** A tag pill that links to /knowledge/tags/[id] - "everything with this
 * tag", across every taggable type (see the search page's tag-browse mode
 * and backend/knowledge/views.py's SearchView). Shared by every detail page
 * that renders a content type's tags, so they all navigate the same way. */
export function TagChip({ tag }: { tag: Tag }) {
  return (
    <Link
      href={`/knowledge/tags/${tag.id}`}
      className="px-2.5 py-1 rounded-full bg-surface-container-low text-on-surface-variant font-label-caps text-label-caps uppercase border border-outline-variant hover:border-primary hover:text-primary transition-colors"
    >
      #{tag.name}
    </Link>
  );
}
