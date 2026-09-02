"use client";

import { useTranslations } from "next-intl";

import { Avatar } from "@/components/ui/Avatar";
import { Link } from "@/i18n/navigation";
import type { KnowledgeAuthor } from "@/lib/api/types";
import { formatPersonName } from "@/lib/format";

interface ContributorsRowProps {
  contributors: KnowledgeAuthor[];
}

// Distinct authors of every create/update AuditLog entry for this object
// (see backend's ContributorsMixin/services.contributors_for) - shown near
// each detail page's own "by {author}" byline (or, for the engineering
// types that have no byline at all, in its place) as its own "who's
// touched this" row, since it can include editors beyond the original author.
export function ContributorsRow({ contributors }: ContributorsRowProps) {
  const t = useTranslations("common");
  if (contributors.length === 0) return null;

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="font-label-caps text-label-caps uppercase text-on-surface-variant">
        {t("contributorsLabel")}
      </span>
      <div className="flex items-center gap-1.5 flex-wrap">
        {contributors.map((person) => (
          <Link
            key={person.id}
            href={`/users/${person.id}`}
            title={formatPersonName(person) ?? undefined}
            className="hover:opacity-80 transition-opacity"
          >
            <Avatar person={person} size="sm" />
          </Link>
        ))}
      </div>
    </div>
  );
}
