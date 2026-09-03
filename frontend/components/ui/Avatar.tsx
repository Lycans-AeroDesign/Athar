import { AuthenticatedImage } from "./AuthenticatedImage";
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

// Renders `person.profile_picture` (uploaded via the account page, see
// AuthenticatedImage.tsx for why this needs a JS fetch rather than a plain
// <img src>) when set; falls back to an initials circle (matching the
// Stitch reference's revision-history avatars) everywhere a photo hasn't
// been uploaded, or can't be fetched (e.g. a Guest viewer, who doesn't hold
// file.read) - answer authors, question askers, revision editors, the
// account page header, TopBar, and everywhere else a person is shown.
function InitialsCircle({ person, size }: AvatarProps) {
  return (
    <div
      className={`${SIZE_CLASSES[size ?? "md"]} shrink-0 rounded-full bg-secondary-container flex items-center justify-center`}
    >
      <span className="font-label-caps text-label-caps text-on-secondary-container">{getInitials(person)}</span>
    </div>
  );
}

export function Avatar({ person, size = "md" }: AvatarProps) {
  if (person?.profile_picture) {
    return (
      <AuthenticatedImage
        src={person.profile_picture.download_url}
        alt={getInitials(person)}
        className={`${SIZE_CLASSES[size]} shrink-0 rounded-full object-cover bg-secondary-container`}
        fallback={<InitialsCircle person={person} size={size} />}
      />
    );
  }

  return <InitialsCircle person={person} size={size} />;
}
