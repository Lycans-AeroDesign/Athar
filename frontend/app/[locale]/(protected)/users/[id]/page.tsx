"use client";

import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";

import { ContributionsPanel } from "@/components/knowledge/ContributionsPanel";
import { Avatar } from "@/components/ui/Avatar";
import { DetailMessage } from "@/components/ui/DetailMessage";
import { Icon } from "@/components/ui/Icon";
import { getUserProfile } from "@/lib/api/knowledge";
import { formatDate } from "@/lib/datetime";
import { formatPersonName } from "@/lib/format";
import { useResource } from "@/lib/useResource";

export default function UserProfilePage() {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations("userProfile");

  const { data: profile, notFound } = useResource(id, getUserProfile);

  if (notFound) {
    return <DetailMessage error>{t("notFound")}</DetailMessage>;
  }
  if (!profile) {
    return <DetailMessage>{t("loading")}</DetailMessage>;
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
            {profile.email && (
              <span className="flex items-center gap-1">
                <Icon name="mail" size={14} />
                {profile.email}
              </span>
            )}
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
