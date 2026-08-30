import { getInitials } from "@/lib/format";
import type { KnowledgeAuthor } from "@/lib/api/types";

interface AvatarProps {
  person: KnowledgeAuthor | null | undefined;
  size?: "sm" | "md";
}

const SIZE_CLASSES = {
  sm: "h-8 w-8",
  md: "h-10 w-10",
};

// No profile photos in this app - an initials circle (matching the Stitch
// reference's revision-history avatars) stands in everywhere a photo avatar
// would otherwise go (answer authors, question askers, revision editors).
export function Avatar({ person, size = "md" }: AvatarProps) {
  return (
    <div
      className={`${SIZE_CLASSES[size]} shrink-0 rounded-full bg-secondary-container flex items-center justify-center`}
    >
      <span className="font-label-caps text-label-caps text-on-secondary-container">{getInitials(person)}</span>
    </div>
  );
}
