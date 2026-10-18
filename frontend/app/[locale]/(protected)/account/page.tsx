"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { DataPrivacyPanel } from "@/components/account/DataPrivacyPanel";
import { EditProfileModal } from "@/components/account/EditProfileModal";
import { PreferencesPanel } from "@/components/account/PreferencesPanel";
import { ContributionsPanel } from "@/components/knowledge/ContributionsPanel";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { getUserProfile } from "@/lib/api/knowledge";
import type { UserProfile } from "@/lib/api/types";
import { useAuth } from "@/lib/auth/AuthProvider";
import { formatDate } from "@/lib/datetime";
import { formatPersonName } from "@/lib/format";

type AccountTab = "contributions" | "preferences" | "data";

// Identity header up top (with Edit Profile opening a dialog rather than a
// long inline form), then two tabs: your contributions - the thing you come
// here to check most often, so it's the default - and your personal
// preferences.
export default function AccountPage() {
  const t = useTranslations("account");
  const commonT = useTranslations("common");
  const profileT = useTranslations("userProfile");
  const { user } = useAuth();
  const [tab, setTab] = useState<AccountTab>("contributions");
  const [isEditOpen, setIsEditOpen] = useState(false);

  // A second fetch beyond `user` (which has no `stats`) since
  // ContributionsPanel needs the same aggregate counts /users/[id] computes
  // server-side (see knowledge/views.py's UserProfileView).
  const [profile, setProfile] = useState<UserProfile | null>(null);
  useEffect(() => {
    if (user) getUserProfile(user.id).then(setProfile);
  }, [user]);

  if (!user) return null;

  const tabs: { id: AccountTab; label: string; icon: string }[] = [
    { id: "contributions", label: t("myContributionsTitle"), icon: "trophy" },
    { id: "preferences", label: t("preferences.title"), icon: "settings" },
    { id: "data", label: t("data.title"), icon: "privacy_tip" },
  ];

  return (
    <section className="space-y-6">
      {/* Sourced from `user` (available synchronously from AuthProvider)
          rather than waiting on the async `profile` fetch, so this never
          flashes empty - same header treatment as /users/[id]. */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-4 bg-surface-container-low border border-outline-variant rounded-xl p-5 sm:p-6">
        <div className="flex items-center gap-4 min-w-0 flex-1">
          <Avatar person={user} size="md" />
          <div className="min-w-0">
            <h1 className="font-headline-lg text-headline-lg text-on-surface truncate">{formatPersonName(user)}</h1>
            {user.title && <p className="font-body-md text-body-md text-on-surface-variant truncate">{user.title}</p>}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 font-mono-sm text-mono-sm text-on-surface-variant">
              <span className="flex items-center gap-1 min-w-0">
                <Icon name="mail" size={14} className="shrink-0" />
                <span className="truncate">{user.email}</span>
              </span>
              <span className="flex items-center gap-1">
                <Icon name="calendar_month" size={14} />
                {profileT("joinedLabel", { date: formatDate(user.date_joined) })}
              </span>
            </div>
            {user.roles.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {user.roles.map((role) => (
                  <span
                    key={role}
                    className="px-2 py-0.5 rounded-full bg-surface-container border border-outline-variant text-on-surface-variant font-label-caps text-label-caps uppercase"
                  >
                    {role}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
        <Button variant="secondary" onClick={() => setIsEditOpen(true)} className="shrink-0 self-start sm:self-center">
          <Icon name="edit" size={16} />
          {t("editProfileButton")}
        </Button>
      </div>

      <div className="flex gap-6 overflow-x-auto border-b border-outline-variant" role="tablist">
        {tabs.map(({ id, label, icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`flex shrink-0 items-center gap-1.5 pb-3 font-label-caps text-label-caps uppercase border-b-2 transition-colors -mb-px ${
              tab === id
                ? "border-primary text-primary"
                : "border-transparent text-on-surface-variant hover:text-on-surface"
            }`}
          >
            <Icon name={icon} size={16} />
            {label}
          </button>
        ))}
      </div>

      {tab === "contributions" ? (
        profile ? (
          <ContributionsPanel profile={profile} />
        ) : (
          <p className="font-body-md text-body-md text-on-surface-variant">{commonT("loading")}</p>
        )
      ) : tab === "preferences" ? (
        <div className="max-w-2xl">
          <PreferencesPanel />
        </div>
      ) : (
        <div className="max-w-2xl">
          <DataPrivacyPanel />
        </div>
      )}

      {isEditOpen && <EditProfileModal user={user} onClose={() => setIsEditOpen(false)} />}
    </section>
  );
}
