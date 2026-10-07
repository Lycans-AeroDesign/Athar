"use client";

import { useTranslations } from "next-intl";
import { Fragment } from "react";

import { Link } from "@/i18n/navigation";
import type { KnowledgeAuthor } from "@/lib/api/types";
import { formatPersonName } from "@/lib/format";

interface CoAuthorsBylineProps {
  coAuthors: KnowledgeAuthor[];
}

/** "with A, B" - rendered right after an Article/Question's "by {author}" byline. */
export function CoAuthorsByline({ coAuthors }: CoAuthorsBylineProps) {
  const t = useTranslations("creation");
  if (coAuthors.length === 0) return null;

  return (
    <span>
      {t("bylineWith")}{" "}
      {coAuthors.map((person, index) => (
        <Fragment key={person.id}>
          {index > 0 && ", "}
          <Link href={`/users/${person.id}`} className="hover:text-primary hover:underline transition-colors">
            {formatPersonName(person)}
          </Link>
        </Fragment>
      ))}
    </span>
  );
}
