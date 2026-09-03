"use client";

import { useTranslations } from "next-intl";

import { BookmarksPanel } from "@/components/knowledge/BookmarksPanel";

export default function BookmarksPage() {
  const t = useTranslations("bookmarksPage");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-display text-on-surface">{t("title")}</h1>
        <p className="font-body-lg text-body-lg text-on-surface-variant mt-2">{t("description")}</p>
      </div>

      <BookmarksPanel />
    </div>
  );
}
