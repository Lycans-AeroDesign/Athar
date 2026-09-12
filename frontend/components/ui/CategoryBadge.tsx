import { Icon } from "./Icon";

// Deliberately a solid-filled pill (secondary-container) with a folder icon,
// not an outlined pill like TagChip - a category is the one classification
// an item belongs to, tags are many flexible labels, and they should read
// as different tiers of information at a glance, not as interchangeable
// chips in the same row. Takes a bare `name` (not a `Category`/
// `CourseCategory` object) so it works for either type without a union.
export function CategoryBadge({ name }: { name: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 font-label-caps text-label-caps uppercase rounded-full px-3 py-1 bg-secondary-container text-on-secondary-container">
      <Icon name="folder" size={12} />
      {name}
    </span>
  );
}
