"use client";

import { useTranslations } from "next-intl";

import { apiUrl } from "@/lib/api/client";
import { useOrganization } from "@/lib/organization/OrganizationProvider";

import { BrandMark } from "./BrandMark";

// Full-viewport loading state for when the app shell has nothing to render
// yet (session/auth resolving) - not for a loading state inside an
// already-rendered page, which should use a smaller inline indicator instead.
export function LoadingScreen() {
  const { settings } = useOrganization();
  const t = useTranslations("common");

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-background">
      <div className="relative h-16 w-16">
        <span className="absolute -inset-2 rounded-full border-2 border-primary/25 border-t-primary animate-spin" />
        {settings?.logo_url ? (
          // eslint-disable-next-line @next/next/no-img-element -- external backend URL, not a local asset next/image can optimize.
          <img
            src={apiUrl(settings.logo_url)}
            alt={settings.name}
            className="h-16 w-16 rounded-xl object-contain animate-pulse"
          />
        ) : (
          <BrandMark className="h-16 w-16 animate-pulse" />
        )}
      </div>
      <p className="font-label-caps text-label-caps uppercase text-on-surface-variant">
        {t("loading")}
      </p>
    </div>
  );
}
