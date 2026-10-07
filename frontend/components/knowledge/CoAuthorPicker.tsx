"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Avatar } from "@/components/ui/Avatar";
import { Combobox } from "@/components/ui/Combobox";
import { Icon } from "@/components/ui/Icon";
import { getOrgMembers } from "@/lib/api/knowledge";
import type { KnowledgeAuthor } from "@/lib/api/types";
import { formatPersonName } from "@/lib/format";

interface CoAuthorPickerProps {
  value: KnowledgeAuthor[];
  onChange: (value: KnowledgeAuthor[]) => void;
  /** The item's author (or, for a new item, the current user) - never offered as a co-author. */
  authorId: string | null | undefined;
  /** False for a co-author editing someone else's item - they can see the list but not change it. */
  canEdit: boolean;
}

// Co-authors for an Article/Question - credited alongside the author, with
// the same edit and RESTRICTED-visibility rights (see backend
// visibility.CO_OWNER_FIELD). Same member source as RestrictedAccessPicker.
export function CoAuthorPicker({ value, onChange, authorId, canEdit }: CoAuthorPickerProps) {
  const t = useTranslations("creation");
  const [members, setMembers] = useState<KnowledgeAuthor[]>([]);

  useEffect(() => {
    if (!canEdit) return;
    getOrgMembers().then(setMembers);
  }, [canEdit]);

  const selectedIds = new Set(value.map((user) => user.id));
  const pickable = members.filter((member) => member.id !== authorId && !selectedIds.has(member.id));

  return (
    <div className="space-y-2">
      <label className="block font-label-caps text-label-caps text-on-surface-variant uppercase">
        {t("coAuthorsLabel")}
      </label>
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {value.map((user) => (
            <li
              key={user.id}
              className="flex items-center gap-1.5 ps-1 pe-2 py-1 rounded-full bg-secondary-container text-on-secondary-container font-body-sm text-body-sm"
            >
              <Avatar person={user} size="sm" />
              <span className="truncate max-w-[180px]">{formatPersonName(user)}</span>
              {canEdit && (
                <button
                  type="button"
                  onClick={() => onChange(value.filter((other) => other.id !== user.id))}
                  aria-label={t("removeCoAuthor", { name: formatPersonName(user) ?? "" })}
                  className="text-on-secondary-container/70 hover:text-error transition-colors"
                >
                  <Icon name="close" size={14} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canEdit ? (
        <Combobox
          placeholder={t("coAuthorsPlaceholder")}
          options={pickable.map((member) => ({
            value: member.id,
            label: `${formatPersonName(member)} (${member.email})`,
          }))}
          value={null}
          onChange={(id) => {
            const member = members.find((m) => m.id === id);
            if (member) onChange([...value, member]);
          }}
        />
      ) : (
        <p className="font-body-sm text-body-sm text-on-surface-variant">{t("coAuthorsLocked")}</p>
      )}
    </div>
  );
}
