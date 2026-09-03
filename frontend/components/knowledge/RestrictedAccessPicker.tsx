"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Combobox } from "@/components/ui/Combobox";
import { Icon } from "@/components/ui/Icon";
import { getOrgMembers } from "@/lib/api/knowledge";
import type { AccessGrant, KnowledgeAuthor } from "@/lib/api/types";
import { useAuth } from "@/lib/auth/AuthProvider";

/** Staged add/remove diff against an item's already-saved `restricted_to` -
 * mirrors RolesSettingsForm's pendingAssign/pendingUnassign pattern, just for
 * one item's grant list instead of a role's user membership. The owning
 * editor applies this on save via addAccessGrant/removeAccessGrant, then
 * discards it (the freshly-saved item's own restricted_to becomes the new
 * source of truth). */
export interface RestrictedAccessDraft {
  pendingAdd: KnowledgeAuthor[];
  pendingRemoveGrantIds: string[];
}

export const EMPTY_RESTRICTED_ACCESS_DRAFT: RestrictedAccessDraft = { pendingAdd: [], pendingRemoveGrantIds: [] };

interface RestrictedAccessPickerProps {
  /** The item's currently-saved grants (empty for a not-yet-created item). */
  initialGrants: AccessGrant[];
  value: RestrictedAccessDraft;
  onChange: (value: RestrictedAccessDraft) => void;
}

export function RestrictedAccessPicker({ initialGrants, value, onChange }: RestrictedAccessPickerProps) {
  const t = useTranslations("restrictedAccess");
  const { user: currentUser } = useAuth();
  const [members, setMembers] = useState<KnowledgeAuthor[] | null>(null);

  useEffect(() => {
    getOrgMembers().then(setMembers);
  }, []);

  const pendingRemoveIds = new Set(value.pendingRemoveGrantIds);
  const pendingAddIds = new Set(value.pendingAdd.map((u) => u.id));

  const effective = [
    ...initialGrants.map((grant) => ({
      grantId: grant.grant_id,
      user: grant.user,
      pending: pendingRemoveIds.has(grant.grant_id) ? ("remove" as const) : null,
    })),
    ...value.pendingAdd.map((user) => ({ grantId: null, user, pending: "add" as const })),
  ];

  const pickableMembers = (members ?? []).filter(
    (member) =>
      member.id !== currentUser?.id &&
      !initialGrants.some((grant) => grant.user.id === member.id && !pendingRemoveIds.has(grant.grant_id)) &&
      !pendingAddIds.has(member.id),
  );

  function handleAdd(userId: string) {
    const member = (members ?? []).find((m) => m.id === userId);
    if (!member) return;
    onChange({ ...value, pendingAdd: [...value.pendingAdd, member] });
  }

  function handleRemoveExisting(grantId: string) {
    onChange({ ...value, pendingRemoveGrantIds: [...value.pendingRemoveGrantIds, grantId] });
  }

  function handleUndoRemoveExisting(grantId: string) {
    onChange({ ...value, pendingRemoveGrantIds: value.pendingRemoveGrantIds.filter((id) => id !== grantId) });
  }

  function handleRemovePendingAdd(userId: string) {
    onChange({ ...value, pendingAdd: value.pendingAdd.filter((u) => u.id !== userId) });
  }

  return (
    <div className="space-y-3">
      <label className="block font-label-caps text-label-caps text-on-surface-variant uppercase">
        {t("label")}
      </label>

      {effective.length === 0 ? (
        <p className="font-body-sm text-body-sm text-on-surface-variant">{t("emptyState")}</p>
      ) : (
        <ul className="space-y-1">
          {effective.map(({ grantId, user, pending }) => (
            <li
              key={user.id}
              className={`flex items-center justify-between px-3 py-2 rounded-lg font-body-md text-body-md ${
                pending === "add"
                  ? "bg-tertiary-container text-on-tertiary-container"
                  : pending === "remove"
                    ? "bg-surface-container text-on-surface-variant line-through opacity-70"
                    : "bg-secondary-container text-on-secondary-container"
              }`}
            >
              <span className="truncate">
                {user.first_name} {user.last_name} <span className="opacity-75">({user.email})</span>
              </span>
              {pending === "remove" ? (
                <button
                  type="button"
                  onClick={() => handleUndoRemoveExisting(grantId!)}
                  className="font-label-caps text-label-caps uppercase text-on-surface-variant hover:text-primary transition-colors shrink-0 ml-2"
                >
                  {t("undo")}
                </button>
              ) : pending === "add" ? (
                <button
                  type="button"
                  onClick={() => handleRemovePendingAdd(user.id)}
                  aria-label={t("remove")}
                  className="text-on-surface-variant hover:text-error transition-colors shrink-0 ml-2"
                >
                  <Icon name="close" size={14} />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => handleRemoveExisting(grantId!)}
                  className="font-label-caps text-label-caps uppercase text-on-surface-variant hover:text-error transition-colors shrink-0 ml-2"
                >
                  {t("remove")}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <Combobox
        placeholder={t("addPlaceholder")}
        options={pickableMembers.map((member) => ({
          value: member.id,
          label: `${member.first_name} ${member.last_name} (${member.email})`,
        }))}
        value={null}
        onChange={handleAdd}
      />
    </div>
  );
}
