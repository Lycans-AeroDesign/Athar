"use client";

import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { ContributionsPanel } from "@/components/knowledge/ContributionsPanel";
import { Avatar } from "@/components/ui/Avatar";
import { Icon } from "@/components/ui/Icon";
import { getUserProfile } from "@/lib/api/knowledge";
import type { UserProfile } from "@/lib/api/types";
import { formatDate } from "@/lib/datetime";
import { formatPersonName } from "@/lib/format";

export default function UserProfilePage() {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations("userProfile");

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    getUserProfile(id).then(setProfile, () => setNotFound(true));
  }, [id]);

  if (notFound) {
    return <p className="font-body-md text-body-md text-error">{t("notFound")}</p>;
  }
  if (!profile) {
    return <p className="font-body-md text-body-md text-on-surface-variant">{t("loading")}</p>;
  }

  const name = formatPersonName(profile);

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-4 bg-surface-container-low border border-outline-variant rounded-xl p-6">
        <Avatar person={profile} size="md" />
        <div className="min-w-0">
          <h1 className="font-display text-display text-on-surface truncate">{name}</h1>
          {profile.title && <p className="font-body-lg text-body-lg text-on-surface-variant">{profile.title}</p>}
          <div className="flex flex-wrap items-center gap-3 mt-2 font-mono-sm text-mono-sm text-on-surface-variant">
            <span className="flex items-center gap-1">
              <Icon name="mail" size={14} />
              {profile.email}
            </span>
            <span className="flex items-center gap-1">
              <Icon name="calendar_month" size={14} />
              {t("joinedLabel", { date: formatDate(profile.date_joined) })}
            </span>
          </div>
        </div>
      </div>

      <ContributionsPanel profile={profile} />
    </div>
  );
}
