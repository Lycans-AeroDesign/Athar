"use client";

import { useTranslations } from "next-intl";
import { useEffect } from "react";

import { useVisibleSettingsGroups } from "@/components/settings/sections";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Link, useRouter } from "@/i18n/navigation";

// Desktop (`lg` and up): /settings has no content of its own - it forwards
// to the first section this viewer can open (permissions and viewport are
// only known client-side, hence a client redirect). Below `lg`, this *is*
// the section list (SettingsShell renders it), so nothing is rendered here.
// A role with none of the settings permissions gets pointed at My Account,
// where personal preferences live.
const DESKTOP_QUERY = "(min-width: 64rem)"; // Tailwind's `lg`
export default function SettingsIndexPage() {
  const t = useTranslations("settings");
  const router = useRouter();
  const groups = useVisibleSettingsGroups();
  const firstSection = groups[0]?.sections[0]?.id;

  useEffect(() => {
    if (!firstSection) return;
    const query = window.matchMedia(DESKTOP_QUERY);
    const forward = () => {
      if (query.matches) router.replace(`/settings/${firstSection}`);
    };
    forward();
    // Also covers widening the window (or rotating a tablet) past `lg`
    // while on the mobile list.
    query.addEventListener("change", forward);
    return () => query.removeEventListener("change", forward);
  }, [firstSection, router]);

  if (firstSection) return null;

  return (
    <div className="space-y-2">
      <h2 className="font-headline-md text-headline-md text-on-surface">{t("noSectionsTitle")}</h2>
      <EmptyState
        icon="settings"
        message={t("noSectionsDescription")}
        action={
          <Link href="/account">
            <Button>{t("goToAccount")}</Button>
          </Link>
        }
      />
    </div>
  );
}
