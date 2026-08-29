"use client";

import { useTranslations } from "next-intl";

import { Can } from "@/components/auth/Can";
import { ArticleEditor } from "@/components/knowledge/ArticleEditor";

export default function NewArticlePage() {
  const t = useTranslations("knowledge.article");

  return (
    <Can
      permission="article.create"
      fallback={<p className="font-body-md text-body-md text-on-surface-variant">{t("createPermissionRequired")}</p>}
    >
      <ArticleEditor />
    </Can>
  );
}
