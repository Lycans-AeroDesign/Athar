"use client";

import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { ArticleEditor } from "@/components/knowledge/ArticleEditor";
import { getArticle } from "@/lib/api/knowledge";
import type { ArticleDetail } from "@/lib/api/types";
import { useAuth } from "@/lib/auth/AuthProvider";
import { useHasPermission } from "@/lib/auth/permissions";

export default function EditArticlePage() {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations("knowledge.article");
  const { user } = useAuth();
  const canUpdateAny = useHasPermission("article.update");

  const [article, setArticle] = useState<ArticleDetail | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    getArticle(id).then(setArticle, () => setNotFound(true));
  }, [id]);

  if (notFound) {
    return <p className="font-body-md text-body-md text-error">{t("notFound")}</p>;
  }
  if (!article) {
    return <p className="font-body-md text-body-md text-on-surface-variant">{t("loading")}</p>;
  }

  const canEdit = user?.id === article.author?.id || canUpdateAny;
  if (!canEdit) {
    return <p className="font-body-md text-body-md text-on-surface-variant">{t("editPermissionRequired")}</p>;
  }

  return <ArticleEditor article={article} />;
}
